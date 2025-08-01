require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const { connectRedis, getClient } = require('./redisClient');
const projectManager = require('./projectManager');
const searchManager = require('./searchManager');

// Create Express app FIRST
const app = express();

// Then create HTTP server with the app
const server = http.createServer(app);

// Then create Socket.IO instance
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Apply middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));// Serve static files from the root directory
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
        socket.join(room);
        
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
        socket.to(room).emit('code-change', {
            ...data,
            userId: userId,
            userName: userName
        });
    });
    
    socket.on('cursor-change', (data) => {
        const room = `project-${data.projectId}`;
        socket.to(room).emit('cursor-change', {
            ...data,
            userId: userId
        });
    });
    
    socket.on('file-created', (data) => {
        const room = `project-${data.projectId}`;
        socket.to(room).emit('file-created', {
            ...data,
            userId: userId,
            userName: userName
        });
    });
    
    socket.on('file-deleted', (data) => {
        const room = `project-${data.projectId}`;
        socket.to(room).emit('file-deleted', {
            ...data,
            userId: userId,
            userName: userName
        });
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Notify all rooms this user was in
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.to(room).emit('user-left', { userId: userId });
            }
        });
        
        activeUsers.delete(socket.id);
    });
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

// In server.js, ensure the delete folder endpoint looks like this:
app.delete('/api/projects/:projectId/folders/:folderPath(*)', async (req, res) => {
    try {
        const { projectId } = req.params;
        // Handle the wildcard parameter correctly
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

startServer();