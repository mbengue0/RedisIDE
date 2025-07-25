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

        try {
            // Try to use JSON.SET command directly
            await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
        } catch (error) {
            // Fallback: Store as a regular string if RedisJSON is not available
            console.log('RedisJSON not available, using string storage');
            await this.client.set(`project:${projectId}`, JSON.stringify(project));
        }
        
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
                const project = await this.getProject(id);
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
        try {
            // Try RedisJSON first
            const result = await this.client.sendCommand(['JSON.GET', `project:${projectId}`]);
            return JSON.parse(result);
        } catch (error) {
            // Fallback to string storage
            const projectStr = await this.client.get(`project:${projectId}`);
            return projectStr ? JSON.parse(projectStr) : null;
        }
    }

    // Update the addFileToProject method in src/projectManager.js
    async addFileToProject(projectId, filepath, content = '') {
        const pathParts = filepath.split('/').filter(p => p); // Remove empty parts
        const filename = pathParts.pop(); // Get the filename
        
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
        try {
            // Get current project
            const project = await this.getProject(projectId);
            if (!project) {
                throw new Error('Project not found');
            }

            // Navigate/create the folder structure
            let current = project.files;
            
            // Create all folders in the path
            for (let i = 0; i < pathParts.length; i++) {
                const folderName = pathParts[i];
                
                // If folder doesn't exist, create it
                if (!current[folderName]) {
                    current[folderName] = {
                        type: 'folder',
                        name: folderName,
                        children: {}
                    };
                }
                
                // Navigate into the folder
                if (!current[folderName].children) {
                    current[folderName].children = {};
                }
                current = current[folderName].children;
            }
            
            // Add the file to the final folder
            current[filename] = {
                type: 'file',
                name: filename,
                path: filepath,
                size: Buffer.byteLength(content, 'utf8'),
                updatedAt: new Date().toISOString()
            };

            // Update project
            project.updatedAt = new Date().toISOString();
            
            // Save updated project
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }
        } catch (error) {
            console.error('Error updating project structure:', error);
            throw error;
        }

        return { success: true, filepath, fileKey };
    }

    // Build JSON path for nested file structure (for RedisJSON)
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
        try {
            const project = await this.getProject(projectId);
            if (!project) {
                throw new Error('Project not found');
            }

            const pathParts = folderPath.split('/').filter(p => p);
            let current = project.files;
            
            pathParts.forEach((folder) => {
                if (!current[folder]) {
                    current[folder] = {
                        type: 'folder',
                        name: folder,
                        children: {}
                    };
                }
                current = current[folder].children || {};
            });

            project.updatedAt = new Date().toISOString();
            
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }

            return { success: true, folderPath };
        } catch (error) {
            console.error('Error creating folder:', error);
            throw error;
        }
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
        try {
            const project = await this.getProject(projectId);
            if (project) {
                project.updatedAt = new Date().toISOString();
                try {
                    await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
                } catch (error) {
                    await this.client.set(`project:${projectId}`, JSON.stringify(project));
                }
            }
        } catch (error) {
            console.error('Error updating project timestamp:', error);
        }

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
        try {
            const project = await this.getProject(projectId);
            if (project) {
                const pathParts = filepath.split('/');
                const filename = pathParts.pop();
                
                let current = project.files;
                for (let i = 0; i < pathParts.length; i++) {
                    if (current[pathParts[i]]) {
                        current = current[pathParts[i]].children || current[pathParts[i]];
                    }
                }
                
                delete current[filename];
                
                project.updatedAt = new Date().toISOString();
                
                try {
                    await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
                } catch (error) {
                    await this.client.set(`project:${projectId}`, JSON.stringify(project));
                }
            }
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
        await this.client.del(`project:${projectId}`);
        
        // Remove from projects list
        await this.client.sRem('projects:list', projectId);

        return { success: true };
    }
}

module.exports = new ProjectManager();