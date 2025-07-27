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
            await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
        } catch (error) {
            console.log('RedisJSON not available, using string storage');
            await this.client.set(`project:${projectId}`, JSON.stringify(project));
        }
        
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
            const result = await this.client.sendCommand(['JSON.GET', `project:${projectId}`]);
            return JSON.parse(result);
        } catch (error) {
            const projectStr = await this.client.get(`project:${projectId}`);
            return projectStr ? JSON.parse(projectStr) : null;
        }
    }

    // Add file to project
    async addFileToProject(projectId, filepath, content = '') {
        const pathParts = filepath.split('/').filter(p => p);
        const filename = pathParts.pop();
        const fileKey = `file:${projectId}:${filepath}`;

        await this.client.hSet(fileKey, {
            content,
            projectId,
            filepath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            size: Buffer.byteLength(content, 'utf8')
        });

        try {
            const project = await this.getProject(projectId);
            if (!project) throw new Error('Project not found');

            let current = project.files;
            for (let i = 0; i < pathParts.length; i++) {
                const folderName = pathParts[i];
                if (!current[folderName]) {
                    current[folderName] = {
                        type: 'folder',
                        name: folderName,
                        children: {}
                    };
                }
                if (!current[folderName].children) {
                    current[folderName].children = {};
                }
                current = current[folderName].children;
            }
            
            current[filename] = {
                type: 'file',
                name: filename,
                path: filepath,
                size: Buffer.byteLength(content, 'utf8'),
                updatedAt: new Date().toISOString()
            };

            project.updatedAt = new Date().toISOString();
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

    // Create folder in project
    async createFolder(projectId, folderPath) {
        try {
            const project = await this.getProject(projectId);
            if (!project) throw new Error('Project not found');

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
        const files = await this.listProjectFiles(projectId);
        for (const file of files) {
            await this.client.del(file.key);
        }
        await this.client.del(`project:${projectId}`);
        await this.client.sRem('projects:list', projectId);
        return { success: true };
    }

    // Replace the ENTIRE renameItem method with this corrected version
    async renameItem(projectId, oldPath, newPath, isFolder = false) {
        try {
            console.log(`Renaming ${isFolder ? 'folder' : 'file'}: ${oldPath} -> ${newPath}`);
            
            if (isFolder) {
                // Get all files that need to be renamed
                const allFiles = await this.listProjectFiles(projectId);
                const affectedFiles = allFiles.filter(file => 
                    file.filepath === oldPath || file.filepath.startsWith(oldPath + '/')
                );
                
                console.log(`Found ${affectedFiles.length} files to rename`);
                
                // Rename each file's Redis key
                for (const file of affectedFiles) {
                    const oldKey = file.key;
                    const newFilePath = file.filepath.replace(oldPath, newPath);
                    const newKey = `file:${projectId}:${newFilePath}`;
                    
                    console.log(`Renaming file: ${file.filepath} -> ${newFilePath}`);
                    
                    // Get the file data
                    const fileData = await this.client.hGetAll(oldKey);
                    
                    if (fileData && Object.keys(fileData).length > 0) {
                        // Create new key with updated filepath
                        await this.client.hSet(newKey, {
                            ...fileData,
                            filepath: newFilePath,
                            updatedAt: new Date().toISOString()
                        });
                        
                        // Delete old key
                        await this.client.del(oldKey);
                        console.log(`Renamed Redis key: ${oldKey} -> ${newKey}`);
                    }
                }
            } else {
                // Handle single file rename
                const oldKey = `file:${projectId}:${oldPath}`;
                const newKey = `file:${projectId}:${newPath}`;
                
                const fileData = await this.client.hGetAll(oldKey);
                
                if (fileData && Object.keys(fileData).length > 0) {
                    await this.client.hSet(newKey, {
                        ...fileData,
                        filepath: newPath,
                        updatedAt: new Date().toISOString()
                    });
                    
                    await this.client.del(oldKey);
                    console.log(`Renamed file: ${oldKey} -> ${newKey}`);
                }
            }
            
            // Rebuild the project structure from the updated files
            await this.updateProjectStructure(projectId);
            
            return { success: true, oldPath, newPath };
        } catch (error) {
            console.error('Error in renameItem:', error);
            throw error;
        }
    }

    // Replace the entire deleteFolder method in projectManager.js
    async deleteFolder(projectId, folderPath) {
        try {
            console.log('Deleting folder:', folderPath); // Debug log
            
            // First, delete all files in the folder
            const allFiles = await this.listProjectFiles(projectId);
            const folderFiles = allFiles.filter(file => 
                file.filepath === folderPath || file.filepath.startsWith(folderPath + '/')
            );
            
            console.log('Files to delete:', folderFiles.length); // Debug log
            
            // Delete all files
            for (const file of folderFiles) {
                await this.client.del(file.key);
            }
            
            // Now update the project structure to remove the folder
            const project = await this.getProject(projectId);
            if (!project) {
                throw new Error('Project not found');
            }
            
            const pathParts = folderPath.split('/').filter(p => p);
            console.log('Path parts:', pathParts); // Debug log
            
            if (pathParts.length === 0) {
                throw new Error('Invalid folder path');
            }
            
            if (pathParts.length === 1) {
                // Root level folder - simply delete it
                if (project.files[pathParts[0]]) {
                    delete project.files[pathParts[0]];
                    console.log('Deleted root folder:', pathParts[0]); // Debug log
                }
            } else {
                // Nested folder - navigate to parent and delete
                let current = project.files;
                let parent = null;
                let parentKey = null;
                
                // Navigate to the parent folder
                for (let i = 0; i < pathParts.length - 1; i++) {
                    const part = pathParts[i];
                    if (current[part] && current[part].children) {
                        parent = current[part];
                        parentKey = 'children';
                        current = current[part].children;
                    } else {
                        throw new Error(`Parent folder not found: ${part}`);
                    }
                }
                
                // Delete the target folder
                const folderName = pathParts[pathParts.length - 1];
                if (parent && parent[parentKey] && parent[parentKey][folderName]) {
                    delete parent[parentKey][folderName];
                    console.log('Deleted nested folder:', folderName); // Debug log
                }
            }
            
            // Save the updated project
            project.updatedAt = new Date().toISOString();
            
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }
            
            console.log('Project structure updated'); // Debug log
            
            return { success: true, deletedCount: folderFiles.length };
        } catch (error) {
            console.error('Error in deleteFolder:', error);
            throw error;
        }
    }

    // Rebuild project structure from files
    async updateProjectStructure(projectId) {
        try {
            const project = await this.getProject(projectId);
            if (!project) return;
            
            project.files = {};
            const files = await this.listProjectFiles(projectId);
            
            files.forEach(file => {
                const parts = file.filepath.split('/');
                let current = project.files;
                
                parts.forEach((part, index) => {
                    if (index === parts.length - 1) {
                        current[part] = {
                            type: 'file',
                            name: part,
                            path: file.filepath,
                            size: file.size,
                            updatedAt: file.updatedAt
                        };
                    } else {
                        if (!current[part]) {
                            current[part] = {
                                type: 'folder',
                                name: part,
                                children: {}
                            };
                        }
                        current = current[part].children;
                    }
                });
            });
            
            project.updatedAt = new Date().toISOString();
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error updating project structure:', error);
            throw error;
        }
    }

    // Rename project
    async renameProject(projectId, newName) {
        try {
            const project = await this.getProject(projectId);
            if (!project) throw new Error('Project not found');
            
            project.name = newName;
            project.updatedAt = new Date().toISOString();
            
            try {
                await this.client.sendCommand(['JSON.SET', `project:${projectId}`, '$', JSON.stringify(project)]);
            } catch (error) {
                await this.client.set(`project:${projectId}`, JSON.stringify(project));
            }
            
            return { success: true, project };
        } catch (error) {
            console.error('Error renaming project:', error);
            throw error;
        }
    }
}

module.exports = new ProjectManager();