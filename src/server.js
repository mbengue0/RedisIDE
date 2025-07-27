require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectRedis, getClient } = require('./redisClient');
const projectManager = require('./projectManager');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Initialize Redis connection
let redisClient;

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

// Update the delete folder endpoint in server.js
app.delete('/api/projects/:projectId/folders/:folderPath(*)', async (req, res) => {
    try {
        const { projectId } = req.params;
        const folderPath = req.params.folderPath || req.params[0]; // Handle both patterns
        
        console.log('Deleting folder:', folderPath); // Debug log
        
        const result = await projectManager.deleteFolder(projectId, folderPath);
        res.json(result);
    } catch (error) {
        console.error('Error deleting folder:', error);
        res.status(500).json({ error: error.message || 'Failed to delete folder' });
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
        
        app.listen(process.env.PORT || 3000, () => {
            console.log(`Server running on port ${process.env.PORT || 3000}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();