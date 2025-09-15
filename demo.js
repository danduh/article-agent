#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';

async function runDemo() {
  console.log('🚀 Article Agent Demo\n');

  try {
    console.log('📋 Step 1: List available topics');
    const topicsResponse = await axios.get(`${BASE_URL}/topics`);
    console.log(`Found ${topicsResponse.data.topics.length} topics:`);
    
    topicsResponse.data.topics.forEach(topic => {
      console.log(`  • ${topic.title} (${topic.id}@${topic.version})`);
    });

    if (topicsResponse.data.topics.length === 0) {
      console.log('❌ No topics found. Please add topic configurations to examples/topics/');
      return;
    }

    const selectedTopic = topicsResponse.data.topics[0];
    console.log(`\n🎯 Selected topic: ${selectedTopic.title}`);

    console.log('\n📖 Step 2: Load topic configuration');
    const topicResponse = await axios.get(
      `${BASE_URL}/topics/${selectedTopic.id}?version=${selectedTopic.version}`
    );
    const topic = topicResponse.data;
    
    console.log(`  • Audience: ${topic.audience}`);
    console.log(`  • Tone: ${topic.tone}`);
    console.log(`  • Length: ${topic.length} words`);
    console.log(`  • Models: ${topic.models.outline} → ${topic.models.draft} → ${topic.models.refine}`);
    console.log(`  • Research: ${topic.research.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  • SEO Keywords: ${topic.seo.keywords.join(', ')}`);

    console.log('\n🏭 Step 3: Generate article');
    const generateResponse = await axios.post(`${BASE_URL}/articles/generate`, {
      topicId: selectedTopic.id,
      version: selectedTopic.version,
      options: {
        skipResearch: false, // Enable research if you have good internet
        saveOutput: true
      }
    });

    const runId = generateResponse.data.runId;
    console.log(`  • Generation started: ${runId}`);

    // Monitor progress
    console.log('\n⏳ Step 4: Monitor progress');
    let completed = false;
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes timeout

    while (!completed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      try {
        const statusResponse = await axios.get(`${BASE_URL}/articles/runs/${runId}/status`);
        const status = statusResponse.data;
        
        process.stdout.write(`\r  • ${status.status} - ${status.currentStage || 'waiting'} (${status.progress}%)    `);

        if (status.status === 'completed') {
          console.log('\n✅ Generation completed!');
          completed = true;

          // Get the run details
          const runResponse = await axios.get(`${BASE_URL}/articles/runs/${runId}`);
          const run = runResponse.data;

          if (run.article_id) {
            console.log('\n📄 Step 5: Retrieve generated article');
            const articleResponse = await axios.get(`${BASE_URL}/articles/${run.article_id}`);
            const article = articleResponse.data;

            console.log(`  • Title: ${article.content.title}`);
            console.log(`  • Word count: ${article.content.word_count}`);
            console.log(`  • Reading time: ${article.content.reading_time_minutes} minutes`);
            console.log(`  • Citations: ${article.citations.length}`);
            console.log(`  • Generation time: ${(article.metadata.generation_time_ms / 1000).toFixed(2)}s`);

            console.log('\n📤 Step 6: Export article in different formats');
            for (const format of ['md', 'html', 'json']) {
              try {
                const exportResponse = await axios.get(
                  `${BASE_URL}/articles/${article.id}/export/${format}`
                );
                const filename = `demo-article.${format}`;
                fs.writeFileSync(filename, exportResponse.data.content);
                console.log(`  • Exported as ${filename}`);
              } catch (error) {
                console.log(`  • Failed to export as ${format}: ${error.message}`);
              }
            }

            console.log('\n🔒 Step 7: Governance features');
            console.log('  • Pin current version for production use');
            console.log('  • View audit trail for compliance');
            console.log('  • Rollback to previous versions if needed');

            console.log('\n🎉 Demo completed successfully!');
            console.log('\n📁 Generated files:');
            console.log('  • demo-article.md - Markdown version');
            console.log('  • demo-article.html - HTML version');
            console.log('  • demo-article.json - JSON version');
            
            console.log('\n🔧 Next steps:');
            console.log('1. Customize topic configurations');
            console.log('2. Add your own AI model API keys');
            console.log('3. Explore governance and version control');
            console.log('4. Scale up for production use');
          }

        } else if (status.status === 'failed') {
          console.log('\n❌ Generation failed');
          
          const runResponse = await axios.get(`${BASE_URL}/articles/runs/${runId}`);
          const run = runResponse.data;
          
          if (run.error) {
            console.log(`  Error: ${run.error}`);
          }

          // Show failed stages
          const failedStages = run.stages.filter(s => s.status === 'failed');
          if (failedStages.length > 0) {
            console.log('  Failed stages:');
            failedStages.forEach(stage => {
              console.log(`    • ${stage.stage}: ${stage.error || 'Unknown error'}`);
            });
          }

          completed = true;
        }

      } catch (error) {
        console.log(`\n❌ Status check failed: ${error.message}`);
        break;
      }
    }

    if (!completed) {
      console.log('\n⏰ Generation timed out');
      console.log('This might happen if:');
      console.log('  • API keys are not configured');
      console.log('  • Network issues with research');
      console.log('  • AI model rate limits');
    }

  } catch (error) {
    console.error('\n❌ Demo failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure the server is running:');
      console.log('   npm run start:dev');
    } else if (error.response?.status === 400) {
      console.log('\n💡 This might be due to missing API keys or configuration issues');
      console.log('   Check your .env file and topic configurations');
    }
    
    process.exit(1);
  }
}

// Run the demo
if (require.main === module) {
  runDemo();
}

module.exports = { runDemo };