require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Claude API setup
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// Google Sheets data - will be fetched and cached
let expertDatabase = [];
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Fetch experts from Google Sheet (CSV export)
async function fetchExpertDatabase() {
  const now = Date.now();
  if (expertDatabase.length > 0 && now - lastFetchTime < CACHE_DURATION) {
    return expertDatabase;
  }

  try {
    // Export Google Sheet as CSV
    const sheetId = '1v-As-SdoND3CYUm59o_LCMICpHOvRv98bYGh8JAHvG0';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    const response = await axios.get(csvUrl);
    const lines = response.data.split('\n');
    const headers = lines[0].split(',');
    
    expertDatabase = [];
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = lines[i].split(',');
      const expert = {
        firstName: values[1]?.trim() || '',
        lastName: values[0]?.trim() || '',
        years: values[2]?.trim() || '',
        field1: values[3]?.trim() || '',
        field2: values[4]?.trim() || '',
        descriptor: values[5]?.trim() || '',
        field3: values[6]?.trim() || '',
        status: parseInt(values[7]) || 0,
        gender: values[8]?.trim() || '',
        geography: values[9]?.trim() || '',
        recognizable: values[10]?.trim() || 'No'
      };
      
      if (expert.firstName && expert.status === 0) {
        expertDatabase.push(expert);
      }
    }
    
    lastFetchTime = now;
    return expertDatabase;
  } catch (error) {
    console.error('Error fetching expert database:', error);
    return expertDatabase;
  }
}

// Call Claude API
async function callClaude(systemPrompt, userMessage) {
  try {
    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: 'claude-opus-4-5-20251101',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ]
      },
      {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );
    
    return response.data.content[0].text;
  } catch (error) {
    console.error('Claude API error:', error.response?.data || error.message);
    throw error;
  }
}

// PHASE 1: Clarity Capture
app.post('/api/phase1', async (req, res) => {
  const { challenge } = req.body;
  
  if (!challenge) {
    return res.status(400).json({ error: 'Challenge required' });
  }

  try {
    const systemPrompt = `You are the Perspectivology Cognitive Engine operating in PHASE 1 — CLARITY CAPTURE.

Your task:
1. Paraphrase the challenge clearly without invention
2. Identify the challenge type (Decision, Strategic planning, Conflict, Career transition, Ethical dilemma, or Problem-solving)
3. If "why it matters" is missing, ask for it
4. Do NOT give advice yet

Output as JSON:
{
  "paraphrase": "Clear restatement of the challenge",
  "challengeType": "Type identified",
  "whyItMatters": "User's explanation or null if missing",
  "needsWhyItMatters": true/false,
  "clarifyingQuestion": "Question to ask if needed (or null)"
}`;

    const response = await callClaude(systemPrompt, challenge);
    const parsed = JSON.parse(response);
    
    res.json({
      phase: 1,
      ...parsed
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PHASE 2: Dream Team Construction
app.post('/api/phase2', async (req, res) => {
  const { challenge, challengeType } = req.body;

  if (!challenge || !challengeType) {
    return res.status(400).json({ error: 'Challenge and challengeType required' });
  }

  try {
    const experts = await fetchExpertDatabase();
    
    // Build expert pool description for Claude
    const expertPool = experts.map(e => 
      `${e.firstName} ${e.lastName} (${e.years}) - ${e.field1}, ${e.descriptor}`
    ).join('\n');

    const systemPrompt = `You are the Perspectivology Cognitive Engine operating in PHASE 2 — DREAM TEAM CONSTRUCTION.

You must construct exactly 9 experts based on this pool:

${expertPool}

Rules:
- Status 0 = available (ONLY use these)
- Generate exactly 9 experts
- Composition: 1 Strategic, 1 Analytical/Data, 1 Ethical, 1 Psychological/Behavioral, 1 Implementation, 1 Systems thinker, 1 Contrarian, 2 context-specific domain experts
- No duplication of cognitive lens
- Ensure disciplinary diversity

Output as JSON:
{
  "team": [
    {
      "name": "Full Name",
      "years": "Years active",
      "field": "Primary field",
      "relevance": "One precise sentence how they help with this challenge",
      "role": "Strategic/Analytical/Ethical/Psychological/Implementation/Systems/Contrarian/Domain"
    }
  ],
  "composition": "Brief explanation of team diversity"
}`;

    const response = await callClaude(systemPrompt, `Challenge type: ${challengeType}\nChallenge: ${challenge}`);
    const parsed = JSON.parse(response);
    
    res.json({
      phase: 2,
      ...parsed,
      swapAvailable: true,
      swapLimit: 3
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PHASE 3: Cognitive Engine Interrogation
app.post('/api/phase3', async (req, res) => {
  const { challenge, team } = req.body;

  if (!challenge || !team) {
    return res.status(400).json({ error: 'Challenge and team required' });
  }

  try {
    const teamNames = team.map(e => e.name).join(', ');
    
    const systemPrompt = `You are the Perspectivology Cognitive Engine operating in PHASE 3 — COGNITIVE ENGINE INTERROGATION.

You will ask 5 context-revealing questions, ONE AT A TIME. Each question reveals assumptions, constraints, incentives, trade-offs, or emotional drivers.

Your Dream Team: ${teamNames}

Output as JSON:
{
  "questionNumber": 1,
  "question": "Question text here",
  "askedBy": "Team member name",
  "reveals": "What this question reveals (assumptions/constraints/incentives/trade-offs/emotional drivers)"
}`;

    const response = await callClaude(systemPrompt, `Challenge: ${challenge}`);
    const parsed = JSON.parse(response);
    
    res.json({
      phase: 3,
      ...parsed,
      totalQuestions: 5
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Perspectivology Engine running on port ${PORT}`);
  fetchExpertDatabase().then(() => {
    console.log('Expert database loaded');
  });
});
