#!/usr/bin/env node

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testBasicFunctionality() {
  console.log('🧪 Testing Article Agent Basic Functionality\n');

  try {
    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check:', healthResponse.data);

    // Test 2: List topics
    console.log('\n2. Testing topic listing...');
    const topicsResponse = await axios.get(`${BASE_URL}/topics`);
    console.log(`✅ Found ${topicsResponse.data.topics.length} topics`);
    
    if (topicsResponse.data.topics.length > 0) {
      const firstTopic = topicsResponse.data.topics[0];
      console.log(`   First topic: ${firstTopic.title} (${firstTopic.id}@${firstTopic.version})`);

      // Test 3: Get specific topic
      console.log('\n3. Testing topic details...');
      const topicResponse = await axios.get(
        `${BASE_URL}/topics/${firstTopic.id}?version=${firstTopic.version}`
      );
      console.log('✅ Topic details loaded successfully');
      console.log(`   Models: ${Object.values(topicResponse.data.models).join(', ')}`);

      // Test 4: Get topic versions
      console.log('\n4. Testing topic versions...');
      const versionsResponse = await axios.get(`${BASE_URL}/topics/${firstTopic.id}/versions`);
      console.log(`✅ Available versions: ${versionsResponse.data.versions.join(', ')}`);

      // Test 5: Validate topic configuration
      console.log('\n5. Testing topic validation...');
      const requiredFields = ['id', 'version', 'title', 'models', 'seo'];
      const missingFields = requiredFields.filter(field => !topicResponse.data[field]);
      
      if (missingFields.length === 0) {
        console.log('✅ Topic configuration is valid');
      } else {
        console.log(`❌ Missing fields: ${missingFields.join(', ')}`);
      }

      // Test 6: Article generation (dry run)
      console.log('\n6. Testing article generation (dry run)...');
      try {
        const generateResponse = await axios.post(`${BASE_URL}/articles/generate`, {
          topicId: firstTopic.id,
          version: firstTopic.version,
          options: {
            dryRun: true,
            skipResearch: true
          }
        });
        console.log(`✅ Article generation started: ${generateResponse.data.runId}`);

        // Monitor the run
        const runId = generateResponse.data.runId;
        let completed = false;
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds timeout

        while (!completed && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;

          try {
            const statusResponse = await axios.get(`${BASE_URL}/articles/runs/${runId}/status`);
            console.log(`   Status: ${statusResponse.data.status} (${statusResponse.data.progress}%)`);

            if (statusResponse.data.status === 'completed' || statusResponse.data.status === 'failed') {
              completed = true;
              
              if (statusResponse.data.status === 'completed') {
                console.log('✅ Article generation completed successfully');
              } else {
                console.log('❌ Article generation failed');
              }
            }
          } catch (error) {
            console.log(`   Status check failed: ${error.message}`);
          }
        }

        if (!completed) {
          console.log('⏰ Article generation timed out (this is normal for testing without API keys)');
        }

      } catch (error) {
        if (error.response?.status === 400 && error.response?.data?.message?.includes('API')) {
          console.log('⚠️  Article generation requires API keys (expected for testing)');
        } else {
          console.log(`❌ Article generation failed: ${error.message}`);
        }
      }
    } else {
      console.log('⚠️  No topics found. Make sure example topics are loaded.');
    }

    console.log('\n🎉 Basic functionality test completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Add your API keys to .env file');
    console.log('2. Try generating a real article');
    console.log('3. Explore the governance features');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure the server is running:');
      console.log('   npm run start:dev');
    }
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testBasicFunctionality();
}

module.exports = { testBasicFunctionality };