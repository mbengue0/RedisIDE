const { v4: uuidv4 } = require('uuid');
const { getClient } = require('./redisClient');

class ProjectManager {
    constructor() {
        this.client = null;
    }

    init() {
        this.client = getClient();
    }

    // Create a new project
    async createProject(name, description = '') {
        const projectId = uuidv4();
        const project = {
            id: projectId,
            name,
            description,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files: {},
            settings: {
                language: 'javascript',
                theme: 'dark'
            }
        };

        // Store project metadata using JSON
        await this.client.json.set(`project:${projectId}`, '$', project);
        
        // Add to projects list
        await this.client.sAdd('projects:list', projectId);
        
        return project;
    }

    // Get all projects
    async listProjects() {
        const projectIds = await this.client.sMembers('projects:list');
        const projects = [];

        for (const id of projectIds) {
            try {
                const project = await this.client.json.get(`project:${id}`);
                if (project) {
                    projects.push(project);
                }
            } catch (error) {
                console.error(`Error loading project ${id}:`, error);
            }
        }

        return projects.sort((a, b) => 
            new Date(b.updatedAt) - new Date(a.updatedAt)
        );
    }

    // Get project by ID
    async getProject(projectId) {
        return await this.client.json.get(`project:${projectId}`);
    }

    // Add file to project
    async addFileToProject(projectId, filepath, content = '') {
        const pathParts = filepath.split('/');
        const filename = pathParts.pop();
        
        // Store file content
        const fileKey = `file:${projectId}:${filepath}`;
        await this.client.hSet(fileKey, {
            content,
            projectId,
            filepath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            size: Buffer.byteLength(content, 'utf8')
        });

        // Update project structure
        const jsonPath = this.buildJsonPath(pathParts, filename);
        await this.client.json.set(
            `project:${projectId}`, 
            jsonPath,
            {
                type: 'file',
                name: filename,
                path: filepath,
                size: Buffer.byteLength(content, 'utf8'),
                updatedAt: new Date().toISOString()
            }
        );

        // Update project's updatedAt
        await this.client.json.set(
            `project:${projectId}`,
            '$.updatedAt',
            new Date().toISOString()
        );

        return { success: true, filepath, fileKey };
    }

    // Build JSON path for nested file structure
    buildJsonPath(folders, filename) {
        let path = '$.files';
        for (const folder of folders) {
            path += `["${folder}"]`;
        }
        path += `["${filename}"]`;
        return path;
    }

    // Create folder in project
    async createFolder(projectId, folderPath) {
        const pathParts = folderPath.split('/').filter(p => p);
        let currentPath = '$.files';
        
        for (const folder of pathParts) {
            const nextPath = currentPath + `["${folder}"]`;
            
            // Check if folder exists
            try {
                const exists = await this.client.json.get(
                    `project:${projectId}`,
                    nextPath
                );
                
                if (!exists) {
                    // Create folder
                    await this.client.json.set(
                        `project:${projectId}`,
                        nextPath,
                        {
                            type: 'folder',
                            name: folder,
                            children: {}
                        }
                    );
                }
            } catch (error) {
                // Folder doesn't exist, create it
                await this.client.json.set(
                    `project:${projectId}`,
                    nextPath,
                    {
                        type: 'folder',
                        name: folder,
                        children: {}
                    }
                );
            }
            
            currentPath = nextPath;
        }

        return { success: true, folderPath };
    }

    // Get file from project
    async getFile(projectId, filepath) {
        const fileKey = `file:${projectId}:${filepath}`;
        return await this.client.hGetAll(fileKey);
    }

    // Update file content
    async updateFile(projectId, filepath, content) {
        const fileKey = `file:${projectId}:${filepath}`;
        
        await this.client.hSet(fileKey, {
            content,
            updatedAt: new Date().toISOString(),
            size: Buffer.byteLength(content, 'utf8')
        });

        // Update project's updatedAt
        await this.client.json.set(
            `project:${projectId}`,
            '$.updatedAt',
            new Date().toISOString()
        );

        return { success: true, filepath };
    }

    // List all files in a project
    async listProjectFiles(projectId) {
        const pattern = `file:${projectId}:*`;
        const keys = await this.client.keys(pattern);
        const files = [];

        for (const key of keys) {
            const fileData = await this.client.hGetAll(key);
            files.push({
                key,
                filepath: fileData.filepath,
                size: parseInt(fileData.size) || 0,
                updatedAt: fileData.updatedAt
            });
        }

        return files;
    }

    // Delete file from project
    async deleteFile(projectId, filepath) {
        const fileKey = `file:${projectId}:${filepath}`;
        await this.client.del(fileKey);

        // Remove from project structure
        const pathParts = filepath.split('/');
        const filename = pathParts.pop();
        const jsonPath = this.buildJsonPath(pathParts, filename);
        
        try {
            await this.client.json.del(`project:${projectId}`, jsonPath);
        } catch (error) {
            console.error('Error removing file from project structure:', error);
        }

        return { success: true };
    }

    // Delete entire project
    async deleteProject(projectId) {
        // Delete all project files
        const files = await this.listProjectFiles(projectId);
        for (const file of files) {
            await this.client.del(file.key);
        }

        // Delete project metadata
        await this.client.json.del(`project:${projectId}`);
        
        // Remove from projects list
        await this.client.sRem('projects:list', projectId);

        return { success: true };
    }
}

module.exports = new ProjectManager();