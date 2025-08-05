require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const { connectRedis, getClient } = require('./redisClient');
const projectManager = require('./projectManager');
const searchManager = require('./searchManager');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Create Express app FIRST
const app = express();

// Then create HTTP server with the app
const server = http.createServer(app);

// Then create Socket.IO instance with better configuration
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    // Add these options for better debugging
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// Apply middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Initialize Redis connection
let redisClient;

// Collaboration state
const sessions = new Map();
const activeUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New collaboration connection:', socket.id);
    
    const { sessionId, userId, userName, userColor } = socket.handshake.query;
    
    // Store user info
    const user = { id: userId, name: userName, color: userColor, socketId: socket.id };
    activeUsers.set(socket.id, user);
    
    socket.on('join-project', (data) => {
        const room = `project-${data.projectId}`;
        console.log(`User ${data.user.name} (${data.user.id}) joining room ${room}`);
        
        // Leave any previous rooms (except the socket's own room)
        socket.rooms.forEach(r => {
            if (r !== socket.id && r.startsWith('project-')) {
                socket.leave(r);
            }
        });
        
        socket.join(room);

        // Log room details
        const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
        console.log(`Room ${room} now has ${roomSize} users`);
        
        // Notify others in the project
        socket.to(room).emit('user-joined', { user: data.user });
        
        // Send current users in the room
        const roomUsers = [];
        io.sockets.adapter.rooms.get(room)?.forEach(socketId => {
            const user = activeUsers.get(socketId);
            if (user) roomUsers.push(user);
        });
        
        socket.emit('active-users', { users: roomUsers });
    });
    
    socket.on('code-change', (data) => {
        const room = `project-${data.projectId}`;
        
        console.log('\n📝 CODE CHANGE EVENT:');
        console.log('   From user:', data.userId);
        console.log('   From socket:', socket.id);
        console.log('   To room:', room);
        
        // Get room info
        const roomSockets = io.sockets.adapter.rooms.get(room);
        if (roomSockets) {
            console.log('   Sockets in room:', Array.from(roomSockets).join(', '));
            console.log('   Broadcasting to:', roomSockets.size - 1, 'other users');
            
            // Broadcast to all OTHER sockets in the room
            socket.to(room).emit('code-change', {
                projectId: data.projectId,
                file: data.file,
                change: data.change,
                content: data.content,
                userId: data.userId,
                userName: data.userName || userName
            });
            
            console.log('   ✅ Broadcast sent');
        } else {
            console.log('   ❌ NO ROOM FOUND!');
        }
    });
    
    socket.on('cursor-change', (data) => {
        const room = `project-${data.projectId}`;
        socket.to(room).emit('cursor-change', {
            ...data,
            userId: data.userId
        });
    });
    
    socket.on('file-created', (data) => {
        const room = `project-${data.projectId}`;
        socket.to(room).emit('file-created', {
            ...data,
            userId: data.userId,
            userName: data.userName || userName
        });
    });
    
    socket.on('file-deleted', (data) => {
        const room = `project-${data.projectId}`;
        socket.to(room).emit('file-deleted', {
            ...data,
            userId: data.userId,
            userName: data.userName || userName
        });
    });
    
    // Add ping-pong for testing
    socket.on('ping', () => {
        console.log('Received ping from:', socket.id);
        socket.emit('pong', { time: Date.now() });
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        const user = activeUsers.get(socket.id);
        
        // Notify all rooms this user was in
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.to(room).emit('user-left', { userId: user?.id || userId });
            }
        });
        
        activeUsers.delete(socket.id);
    });
});

// Add Socket.IO debugging
io.on('connection_error', (err) => {
    console.error('Socket.IO connection error:', err.message);
});

// Project endpoints
// Create new project
app.post('/api/projects', async (req, res) => {
    try {
        const { name, description } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const project = await projectManager.createProject(name, description);
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// List all projects
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await projectManager.listProjects();
        res.json({ projects });
    } catch (error) {
        console.error('Error listing projects:', error);
        res.status(500).json({ error: 'Failed to list projects' });
    }
});

// Get project details
app.get('/api/projects/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const project = await projectManager.getProject(projectId);
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ project });
    } catch (error) {
        console.error('Error getting project:', error);
        res.status(500).json({ error: 'Failed to get project' });
    }
});

// Add file to project
app.post('/api/projects/:projectId/files', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { filepath, content = '' } = req.body;
        
        if (!filepath) {
            return res.status(400).json({ error: 'Filepath is required' });
        }

        const result = await projectManager.addFileToProject(projectId, filepath, content);
        res.json(result);
    } catch (error) {
        console.error('Error adding file to project:', error);
        res.status(500).json({ error: 'Failed to add file to project' });
    }
});

// Get file from project - Fixed the route pattern
app.get('/api/projects/:projectId/files/:filepath(*)', async (req, res) => {
    try {
        const { projectId, filepath } = req.params;
        
        const file = await projectManager.getFile(projectId, filepath);
        
        if (!file || !file.content) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.json({
            filepath,
            content: file.content,
            updatedAt: file.updatedAt,
            size: parseInt(file.size) || 0
        });
    } catch (error) {
        console.error('Error getting file:', error);
        res.status(500).json({ error: 'Failed to get file' });
    }
});

// Update file in project - Fixed the route pattern
app.put('/api/projects/:projectId/files/:filepath(*)', async (req, res) => {
    try {
        const { projectId, filepath } = req.params;
        const { content } = req.body;
        
        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const result = await projectManager.updateFile(projectId, filepath, content);
        res.json(result);
    } catch (error) {
        console.error('Error updating file:', error);
        res.status(500).json({ error: 'Failed to update file' });
    }
});

// Delete file from project - Fixed the route pattern
app.delete('/api/projects/:projectId/files/:filepath(*)', async (req, res) => {
    try {
        const { projectId, filepath } = req.params;
        
        const result = await projectManager.deleteFile(projectId, filepath);
        res.json(result);
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// List all files in project
app.get('/api/projects/:projectId/files', async (req, res) => {
    try {
        const { projectId } = req.params;
        const files = await projectManager.listProjectFiles(projectId);
        res.json({ files });
    } catch (error) {
        console.error('Error listing project files:', error);
        res.status(500).json({ error: 'Failed to list project files' });
    }
});

// Create folder in project
app.post('/api/projects/:projectId/folders', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { folderPath } = req.body;
        
        if (!folderPath) {
            return res.status(400).json({ error: 'Folder path is required' });
        }

        const result = await projectManager.createFolder(projectId, folderPath);
        res.json(result);
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

// Delete project
app.delete('/api/projects/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const result = await projectManager.deleteProject(projectId);
        res.json(result);
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// Rename file or folder
app.put('/api/projects/:projectId/rename', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { oldPath, newPath, isFolder } = req.body;
        
        const result = await projectManager.renameItem(projectId, oldPath, newPath, isFolder);
        res.json(result);
    } catch (error) {
        console.error('Error renaming:', error);
        res.status(500).json({ error: 'Failed to rename' });
    }
});

// Delete folder endpoint
app.delete('/api/projects/:projectId/folders/:folderPath(*)', async (req, res) => {
    try {
        const { projectId } = req.params;
        const folderPath = req.params.folderPath || req.params[0] || '';
        
        console.log('Server: Deleting folder:', folderPath, 'from project:', projectId);
        
        const result = await projectManager.deleteFolder(projectId, folderPath);
        res.json(result);
    } catch (error) {
        console.error('Server: Error deleting folder:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rename project
app.put('/api/projects/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { name } = req.body;
        
        const result = await projectManager.renameProject(projectId, name);
        res.json(result);
    } catch (error) {
        console.error('Error renaming project:', error);
        res.status(500).json({ error: 'Failed to rename project' });
    }
});

// Save file endpoint (from checkpoint 1)
app.post('/api/files', async (req, res) => {
    try {
        const { filename, content } = req.body;
        
        if (!filename || content === undefined) {
            return res.status(400).json({ error: 'Filename and content are required' });
        }

        const key = `file:${filename}`;
        
        await redisClient.hSet(key, {
            content: content,
            updatedAt: new Date().toISOString(),
            size: Buffer.byteLength(content, 'utf8')
        });

        res.json({ 
            success: true, 
            message: `File ${filename} saved successfully`,
            key: key 
        });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// Get file endpoint (from checkpoint 1)
app.get('/api/files/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const key = `file:${filename}`;
        
        const fileData = await redisClient.hGetAll(key);
        
        if (!fileData || !fileData.content) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.json({
            filename,
            content: fileData.content,
            updatedAt: fileData.updatedAt,
            size: parseInt(fileData.size) || 0
        });
    } catch (error) {
        console.error('Error retrieving file:', error);
        res.status(500).json({ error: 'Failed to retrieve file' });
    }
});

// List all files endpoint (from checkpoint 1)
app.get('/api/files', async (req, res) => {
    try {
        const keys = await redisClient.keys('file:*');
        const files = [];

        for (const key of keys) {
            const filename = key.replace('file:', '');
            const metadata = await redisClient.hGet(key, 'updatedAt');
            files.push({
                filename,
                key,
                updatedAt: metadata
            });
        }

        res.json({ files });
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: 'Failed to list files' });
    }
});

// Start server
async function startServer() {
    try {
        // Connect to Redis first
        redisClient = await connectRedis();
        
        // Initialize project manager with the Redis client
        projectManager.init();
        searchManager.init();
        
        // Create search index
        await searchManager.createSearchIndex();
        
        // Optional: reindex existing files
        await searchManager.reindexAllFiles();
        
        server.listen(process.env.PORT || 3000, () => {
            console.log(`Server running on port ${process.env.PORT || 3000}`);
            console.log('Socket.IO is ready for connections');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Global search across all projects
app.get('/api/search', async (req, res) => {
    try {
        const { q, limit = 20, offset = 0, highlight = true } = req.query;
        
        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const results = await searchManager.searchCode(q, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            highlight: highlight === 'true'
        });

        res.json(results);
    } catch (error) {
        console.error('Error searching:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// AI endpoint (optional - can also call directly from frontend)
app.post('/api/ai/complete', async (req, res) => {
    try {
        const { messages, apiKey } = req.body;
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey || process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4-turbo-preview',
                messages: messages,
                temperature: 0.7,
                max_tokens: 1500
            })
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('AI API error:', error);
        res.status(500).json({ error: 'AI request failed' });
    }
});

// Search within a specific project
app.get('/api/projects/:projectId/search', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { q, limit = 20, offset = 0, highlight = true, extensions } = req.query;
        
        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const extensionFilter = extensions ? extensions.split(',') : null;

        const results = await searchManager.searchInProject(projectId, q, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            highlight: highlight === 'true',
            extensions: extensionFilter
        });

        res.json(results);
    } catch (error) {
        console.error('Error searching in project:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.post('/api/projects/:projectId/git/init', async (req, res) => {
    try {
        const { projectId } = req.params;
        
        // Initialize git metadata in Redis
        await redisClient.hSet(`project:${projectId}:git`, 'initialized', 'true');
        await redisClient.hSet(`project:${projectId}:git`, 'currentBranch', 'main');
        await redisClient.hSet(`project:${projectId}:git`, 'createdAt', new Date().toISOString());
        
        // Initialize empty branches object with main branch
        await redisClient.hSet(`project:${projectId}:branches`, 'main', '');
        
        // Create initial commit
        const commitId = `commit:${projectId}:${Date.now()}`;
        await redisClient.hSet(commitId, 'message', 'Initial commit');
        await redisClient.hSet(commitId, 'author', 'System');
        await redisClient.hSet(commitId, 'timestamp', new Date().toISOString());
        await redisClient.hSet(commitId, 'projectId', projectId);
        await redisClient.hSet(commitId, 'branch', 'main');
        await redisClient.hSet(commitId, 'files', '[]');
        
        // Add to commit list
        await redisClient.lPush(`project:${projectId}:branch:main:commits`, commitId);
        
        res.json({ success: true, message: 'Git repository initialized' });
    } catch (error) {
        console.error('Git init error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectId/git/status', async (req, res) => {
    try {
        const { projectId } = req.params;
        
        // Check if git is initialized
        const gitData = await redisClient.hGetAll(`project:${projectId}:git`);
        if (!gitData.initialized) {
            return res.status(404).json({ error: 'No git repository' });
        }
        
        // Get staged files - handle null case
        const stagedFilesData = await redisClient.hGetAll(`project:${projectId}:git:staged`);
        const stagedFiles = stagedFilesData || {};
        console.log('Staged files from Redis:', stagedFiles);
        
        // Get tracked files and their status
        const files = await projectManager.listProjectFiles(projectId);
        const trackedFilesData = await redisClient.hGetAll(`project:${projectId}:git:tracked`);
        const trackedFiles = trackedFilesData || {};
        
        const gitFiles = [];
        
        for (const file of files) {
            const currentContent = await redisClient.hGet(`project:${projectId}:file:${file.filepath}`, 'content') || '';
            const lastCommitContent = trackedFiles[file.filepath];
            
            // Check if file is staged - safe check
            const isStaged = stagedFiles && typeof stagedFiles === 'object' && file.filepath in stagedFiles;
            
            if (!lastCommitContent) {
                // New file
                gitFiles.push({
                    status: '??',
                    path: file.filepath,
                    staged: isStaged,
                    modified: false
                });
            } else if (currentContent !== lastCommitContent) {
                // Modified file
                gitFiles.push({
                    status: 'M',
                    path: file.filepath,
                    staged: isStaged,
                    modified: true
                });
            }
        }
        
        res.json({ files: gitFiles });
    } catch (error) {
        console.error('Git status error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectId/git/add', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { files } = req.body;
        
        console.log('Staging files:', files);
        
        // Stage each file individually with proper string value
        for (const file of files) {
            // Set value as 'staged' string, not boolean
            await redisClient.hSet(`project:${projectId}:git:staged`, file, 'staged');
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Git add error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/projects/:projectId/git/unstage', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { files } = req.body;
        
        // Unstage specific files
        for (const file of files) {
            await redisClient.hDel(`project:${projectId}:git:staged`, file);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Git unstage error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add this endpoint to get file changes
app.get('/api/projects/:projectId/git/diff/:filepath', async (req, res) => {
    try {
        const { projectId, filepath } = req.params;
        const decodedPath = decodeURIComponent(filepath);
        
        // Get current content
        const currentContent = await redisClient.hGet(`project:${projectId}:file:${decodedPath}`, 'content') || '';
        
        // Get last committed content
        const committedContent = await redisClient.hGet(`project:${projectId}:git:tracked`, decodedPath) || '';
        
        // Create a simple diff
        const currentLines = currentContent.split('\n');
        const committedLines = committedContent.split('\n');
        
        res.json({
            filepath: decodedPath,
            currentContent,
            committedContent,
            hasChanges: currentContent !== committedContent,
            additions: currentLines.length - committedLines.length,
            deletions: 0 // You could implement a proper diff algorithm
        });
    } catch (error) {
        console.error('Git diff error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get commit details
app.get('/api/projects/:projectId/git/commits/:commitId', async (req, res) => {
    try {
        const { projectId, commitId } = req.params;
        const commitData = await redisClient.hGetAll(commitId);
        
        if (!commitData.message) {
            return res.status(404).json({ error: 'Commit not found' });
        }
        
        // Get file snapshots for this commit
        const files = JSON.parse(commitData.files || '[]');
        const fileContents = {};
        
        for (const file of files) {
            const content = await redisClient.hGet(`${commitId}:files`, file) || '';
            fileContents[file] = content;
        }
        
        res.json({
            ...commitData,
            fileContents
        });
    } catch (error) {
        console.error('Get commit error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Complete Git Branch System
app.get('/api/projects/:projectId/git/branches', async (req, res) => {
    try {
        const { projectId } = req.params;
        
        // Get all branches
        const branches = await redisClient.hGetAll(`project:${projectId}:branches`) || {};
        const currentBranch = await redisClient.hGet(`project:${projectId}:git`, 'currentBranch') || 'main';
        
        // Get commit count for each branch
        const branchList = [];
        for (const [name, headCommit] of Object.entries(branches)) {
            const commitCount = await redisClient.lLen(`project:${projectId}:branch:${name}:commits`);
            branchList.push({
                name,
                current: name === currentBranch,
                headCommit,
                commitCount
            });
        }
        
        // Ensure main branch exists
        if (!branches.main) {
            branchList.push({
                name: 'main',
                current: currentBranch === 'main',
                headCommit: null,
                commitCount: 0
            });
        }
        
        res.json({ branches: branchList, currentBranch });
    } catch (error) {
        console.error('Git branches error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectId/git/branches', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { branchName, fromBranch } = req.body;
        
        // Get current branch's HEAD commit
        const sourceBranch = fromBranch || await redisClient.hGet(`project:${projectId}:git`, 'currentBranch') || 'main';
        const commits = await redisClient.lRange(`project:${projectId}:branch:${sourceBranch}:commits`, 0, 0);
        const headCommit = commits[0] || null;
        
        // Create new branch
        await redisClient.hSet(`project:${projectId}:branches`, branchName, headCommit || '');
        
        // Copy commit history
        if (headCommit) {
            const allCommits = await redisClient.lRange(`project:${projectId}:branch:${sourceBranch}:commits`, 0, -1);
            if (allCommits.length > 0) {
                await redisClient.rPush(`project:${projectId}:branch:${branchName}:commits`, ...allCommits.reverse());
            }
        }
        
        res.json({ success: true, branch: branchName });
    } catch (error) {
        console.error('Create branch error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectId/git/checkout', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { branchName } = req.body;
        
        // Check if branch exists
        const branches = await redisClient.hGetAll(`project:${projectId}:branches`);
        if (!branches[branchName] && branchName !== 'main') {
            return res.status(404).json({ error: 'Branch not found' });
        }
        
        // Save current branch state before switching
        const currentBranch = await redisClient.hGet(`project:${projectId}:git`, 'currentBranch') || 'main';
        
        // Switch branch
        await redisClient.hSet(`project:${projectId}:git`, 'currentBranch', branchName);
        
        // Load branch's file state
        const headCommit = branches[branchName];
        if (headCommit) {
            // Restore files from this branch's HEAD commit
            const commitFiles = await redisClient.hGetAll(`${headCommit}:files`);
            for (const [filepath, content] of Object.entries(commitFiles)) {
                await redisClient.hSet(`project:${projectId}:file:${filepath}`, 'content', content);
            }
        }
        
        res.json({ success: true, branch: branchName, previousBranch: currentBranch });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Enhanced commit with branch support
app.post('/api/projects/:projectId/git/commit', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { message } = req.body;
        
        const currentBranch = await redisClient.hGet(`project:${projectId}:git`, 'currentBranch') || 'main';
        const stagedFiles = await redisClient.hGetAll(`project:${projectId}:git:staged`) || {};
        const filesToCommit = Object.keys(stagedFiles);
        
        if (filesToCommit.length === 0) {
            return res.status(400).json({ error: 'No files staged for commit' });
        }
        
        // Create commit ID
        const commitId = `commit:${projectId}:${Date.now()}`;
        
        // Get parent commit
        const parentCommits = await redisClient.lRange(`project:${projectId}:branch:${currentBranch}:commits`, 0, 0);
        const parentCommit = parentCommits[0] || null;
        
        // Create commit data - set each field individually
        await redisClient.hSet(commitId, 'id', commitId);
        await redisClient.hSet(commitId, 'message', message);
        await redisClient.hSet(commitId, 'author', 'User');
        await redisClient.hSet(commitId, 'timestamp', new Date().toISOString());
        await redisClient.hSet(commitId, 'branch', currentBranch);
        await redisClient.hSet(commitId, 'parent', parentCommit || '');
        await redisClient.hSet(commitId, 'files', JSON.stringify(filesToCommit));
        
        // Save file snapshots and calculate changes
        const changes = [];
        for (const filepath of filesToCommit) {
            const content = await redisClient.hGet(`project:${projectId}:file:${filepath}`, 'content') || '';
            
            // Get previous content
            let previousContent = '';
            if (parentCommit) {
                previousContent = await redisClient.hGet(`${parentCommit}:files`, filepath) || '';
            }
            
            // Save current snapshot
            await redisClient.hSet(`${commitId}:files`, filepath, content);
            
            // Calculate simple diff stats
            const currentLines = content.split('\n').length;
            const previousLines = previousContent.split('\n').length;
            const added = Math.max(0, currentLines - previousLines);
            const deleted = Math.max(0, previousLines - currentLines);
            
            changes.push({
                file: filepath,
                additions: added,
                deletions: deleted
            });
            
            // Update tracked files
            await redisClient.hSet(`project:${projectId}:git:tracked`, filepath, content);
        }
        
        // Save changes summary
        await redisClient.hSet(`${commitId}:changes`, 'summary', JSON.stringify(changes));
        
        // Clear staged files - delete the entire hash
        await redisClient.del(`project:${projectId}:git:staged`);
        
        // Add to branch's commit list
        await redisClient.lPush(`project:${projectId}:branch:${currentBranch}:commits`, commitId);
        
        // Update branch HEAD
        await redisClient.hSet(`project:${projectId}:branches`, currentBranch, commitId);
        
        res.json({ 
            success: true,
            commitId: commitId,
            branch: currentBranch,
            changes: changes,
            message: `[${currentBranch} ${commitId.split(':').pop().substring(0, 7)}] ${message}`
        });
    } catch (error) {
        console.error('Git commit error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get detailed commit info
app.get('/api/projects/:projectId/git/commits/:commitId/details', async (req, res) => {
    try {
        const { projectId, commitId } = req.params;
        const fullCommitId = commitId.includes(':') ? commitId : `commit:${projectId}:${commitId}`;
        
        const commitData = await redisClient.hGetAll(fullCommitId);
        if (!commitData.message) {
            return res.status(404).json({ error: 'Commit not found' });
        }
        
        // Get file changes
        const files = JSON.parse(commitData.files || '[]');
        const fileChanges = [];
        const changesData = await redisClient.hGet(`${fullCommitId}:changes`, 'summary');
        const changes = changesData ? JSON.parse(changesData) : [];
        
        // Get actual file contents and diffs
        for (const file of files) {
            const currentContent = await redisClient.hGet(`${fullCommitId}:files`, file) || '';
            let previousContent = '';
            
            if (commitData.parent) {
                previousContent = await redisClient.hGet(`${commitData.parent}:files`, file) || '';
            }
            
            fileChanges.push({
                filepath: file,
                status: previousContent ? 'modified' : 'added',
                additions: changes.find(c => c.file === file)?.additions || 0,
                deletions: changes.find(c => c.file === file)?.deletions || 0,
                currentContent,
                previousContent
            });
        }
        
        res.json({
            ...commitData,
            fileChanges
        });
    } catch (error) {
        console.error('Get commit details error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Merge branches
app.post('/api/projects/:projectId/git/merge', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { sourceBranch } = req.body;
        
        const currentBranch = await redisClient.hGet(`project:${projectId}:git`, 'currentBranch') || 'main';
        
        // Get HEAD commits of both branches
        const sourceHead = await redisClient.hGet(`project:${projectId}:branches`, sourceBranch);
        const targetHead = await redisClient.hGet(`project:${projectId}:branches`, currentBranch);
        
        if (!sourceHead) {
            return res.status(400).json({ error: 'Source branch has no commits' });
        }
        
        // For simplicity, we'll do a fast-forward merge
        // In a real implementation, you'd handle conflicts
        
        // Get all files from source branch's HEAD
        const sourceFiles = await redisClient.hGetAll(`${sourceHead}:files`);
        
        // Apply changes to current branch
        for (const [filepath, content] of Object.entries(sourceFiles)) {
            await redisClient.hSet(`project:${projectId}:file:${filepath}`, 'content', content);
        }
        
        // Create merge commit
        const mergeCommitId = `commit:${projectId}:${Date.now()}`;
        await redisClient.hSet(mergeCommitId, {
            message: `Merge branch '${sourceBranch}' into ${currentBranch}`,
            author: 'User',
            timestamp: new Date().toISOString(),
            branch: currentBranch,
            parent: targetHead || null,
            mergeFrom: sourceHead,
            files: JSON.stringify(Object.keys(sourceFiles))
        });
        
        // Update branch
        await redisClient.lPush(`project:${projectId}:branch:${currentBranch}:commits`, mergeCommitId);
        await redisClient.hSet(`project:${projectId}:branches`, currentBranch, mergeCommitId);
        
        res.json({ success: true, mergeCommit: mergeCommitId });
    } catch (error) {
        console.error('Merge error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectId/git/log', async (req, res) => {
    try {
        const { projectId } = req.params;
        
        // Get current branch
        const currentBranch = await redisClient.hGet(`project:${projectId}:git`, 'currentBranch') || 'main';
        
        // Get commit IDs from the current branch
        const commitIds = await redisClient.lRange(`project:${projectId}:branch:${currentBranch}:commits`, 0, 9);
        
        console.log(`Fetching commits for branch ${currentBranch}:`, commitIds);
        
        const commits = [];
        for (const commitId of commitIds) {
            const commitData = await redisClient.hGetAll(commitId);
            console.log('Commit data:', commitId, commitData);
            
            if (commitData && commitData.message) {
                commits.push({
                    hash: commitId.split(':').pop().substring(0, 7),
                    fullHash: commitId,
                    message: commitData.message,
                    author: commitData.author || 'Unknown',
                    timestamp: commitData.timestamp || new Date().toISOString(),
                    branch: commitData.branch || currentBranch
                });
            }
        }
        
        res.json({ 
            commits, 
            branch: currentBranch,
            total: commits.length 
        });
    } catch (error) {
        console.error('Git log error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add this debug endpoint to your backend
app.get('/api/projects/:projectId/git/debug', async (req, res) => {
    try {
        const { projectId } = req.params;
        
        const gitData = await redisClient.hGetAll(`project:${projectId}:git`);
        const branches = await redisClient.hGetAll(`project:${projectId}:branches`);
        const currentBranch = gitData.currentBranch || 'main';
        const mainCommits = await redisClient.lRange(`project:${projectId}:branch:main:commits`, 0, -1);
        const stagedFiles = await redisClient.hGetAll(`project:${projectId}:git:staged`);
        
        res.json({
            gitData,
            branches,
            currentBranch,
            mainCommits,
            stagedFiles,
            commitCount: mainCommits.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

startServer();