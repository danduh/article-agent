#!/bin/bash

# Test script for Article Writer Agent API
# Make sure the server is running: npm run start:dev

API_URL="http://localhost:3000/api"

echo "========================================"
echo "Article Writer Agent API Test Script"
echo "========================================"
echo ""

# 1. Health Check
echo "1. Testing Health Check..."
curl -s "$API_URL/health" | jq '.'
echo ""

# 2. Load Topic Configuration
echo "2. Loading Topic Configuration..."
curl -s -X POST "$API_URL/topics/load" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "file",
    "path": "topics/gen-ui-2025.json"
  }' | jq '.'
echo ""

# 3. List Topics from Directory
echo "3. Listing Topics..."
curl -s "$API_URL/topics/list?directory=topics" | jq '.'
echo ""

# 4. Generate Article (without research for faster demo)
echo "4. Generating Article (this may take 1-2 minutes)..."
curl -s -X POST "$API_URL/articles/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "topicSource": "file",
    "topicPath": "topics/gen-ui-2025.json",
    "skipResearch": true,
    "skipRefinement": false
  }' | jq '.'
echo ""

# 5. List Articles
echo "5. Listing Generated Articles..."
curl -s "$API_URL/articles" | jq '.'
echo ""

# 6. Get Generation Statistics
echo "6. Getting Generation Statistics..."
curl -s "$API_URL/stats/generation" | jq '.'
echo ""

# 7. Get Storage Statistics
echo "7. Getting Storage Statistics..."
curl -s "$API_URL/stats/storage" | jq '.'
echo ""

# 8. Get Run Logs
echo "8. Getting Run Logs..."
curl -s "$API_URL/runs" | jq '.'
echo ""

echo "========================================"
echo "Test Complete!"
echo "========================================"
echo ""
echo "To test streaming generation, run:"
echo "curl -N '$API_URL/articles/generate/stream?topicSource=file&topicPath=topics/gen-ui-2025.json&skipResearch=true'"