require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectRedis, getClient } = require('./redisClient');

const app = express();
const projectManager = require('./projectManager');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Initialize Redis connection
let redisClient;
// Add this in your startServer function after redisClient is connected:
projectManager.init();

// Save file endpoint
app.post('/api/files', async (req, res) => {
    try {
        const { filename, content } = req.body;
        
        if (!filename || content === undefined) {
            return res.status(400).json({ error: 'Filename and content are required' });
        }

        const key = `file:${filename}`;
        
        // Store file with metadata
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

// Get file endpoint
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

// List all files endpoint (bonus!)
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

// Get file from project
app.get('/api/projects/:projectId/files/*', async (req, res) => {
    try {
        const { projectId } = req.params;
        const filepath = req.params[0]; // Everything after /files/
        
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

// Update file in project
app.put('/api/projects/:projectId/files/*', async (req, res) => {
    try {
        const { projectId } = req.params;
        const filepath = req.params[0];
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

// Start server
async function startServer() {
    try {
        redisClient = await connectRedis();
        
        app.listen(process.env.PORT || 3000, () => {
            console.log(`Server running on port ${process.env.PORT || 3000}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();