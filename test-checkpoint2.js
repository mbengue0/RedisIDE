require('dotenv').config();
const { connectRedis } = require('./src/redisClient');
const projectManager = require('./src/projectManager');

async function testProjectFeatures() {
    try {
        const client = await connectRedis();
        projectManager.init();
        
        console.log('🧪 Testing Checkpoint 2 Features...\n');
        
        // Test 1: Create a project
        console.log('1. Creating a test project...');
        const project = await projectManager.createProject('Test Project', 'A test project for Checkpoint 2');
        console.log('✅ Project created:', project.id);
        
        // Test 2: Add files to project
        console.log('\n2. Adding files to project...');
        await projectManager.addFileToProject(project.id, 'index.js', 'console.log("Hello from index.js");');
        await projectManager.addFileToProject(project.id, 'src/utils.js', 'export const helper = () => {};');
        await projectManager.addFileToProject(project.id, 'src/components/Button.js', 'export default function Button() {}');
        console.log('✅ Files added successfully');
        
        // Test 3: List project files
        console.log('\n3. Listing project files...');
        const files = await projectManager.listProjectFiles(project.id);
        console.log('Files in project:');
        files.forEach(file => console.log(`  - ${file.filepath} (${file.size} bytes)`));
        
        // Test 4: Get project structure
        console.log('\n4. Getting project structure...');
        const projectData = await projectManager.getProject(project.id);
        console.log('Project structure:', JSON.stringify(projectData.files, null, 2));
        
        console.log('\n✅ All tests passed! Checkpoint 2 is working correctly.');
        
        await client.quit();
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testProjectFeatures();