// AI service for handling chat with AI models
import Groq from 'groq-sdk';
import 'dotenv/config';

interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

class AIService {
  private groq: Groq | null = null;
  private isInitialized = false;
    // List of models to try in order of preference
  private readonly models = [
    'llama-3.1-8b-instant',
    'llama3-8b-8192',
    'llama3-70b-8192',
    'deepseek-r1-distill-llama-70b', // No daily token limit
    'meta-llama/llama-4-scout-17b-16e-instruct' // Alternative unlimited model
  ];

  constructor() {
    this.initialize();
  }
  private initialize() {
    try {
      const apiKey = process.env.GROQ_API_KEY;
      console.log('[AI Service] Initializing with API key present:', !!apiKey);
      
      if (!apiKey) {
        console.warn('[AI Service] GROQ_API_KEY not found in environment variables. AI chat will be disabled.');
        return;
      }

      // Validate API key format
      if (!apiKey.startsWith('gsk_')) {
        console.error('[AI Service] Invalid Groq API key format. Should start with "gsk_"');
        return;
      }

      this.groq = new Groq({
        apiKey: apiKey
      });
      this.isInitialized = true;
      console.log('[AI Service] Groq API initialized successfully');
    } catch (error) {
      console.error('[AI Service] Failed to initialize Groq:', error);
    }
  }  public async chat(userMessage: string, username: string): Promise<string> {
    console.log('[AI Service] Chat request received:', { userMessage, username, isInitialized: this.isInitialized, hasGroq: !!this.groq });
    
    if (!this.isInitialized || !this.groq) {
      console.log('[AI Service] Service not initialized, returning error message');
      return "🤖 AI chat is not available. Please check the server configuration.";
    }

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `You are a helpful AI assistant in an ephemeral live chat room and the app is called Ucucu. The user's name is ${username}. Keep responses concise and friendly. You're chatting in a group chat environment, so be mindful that others can see this conversation.`
      },
      {
        role: 'user',
        content: userMessage
      }
    ];

    // Try each model until one works
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i];
      
      try {
        console.log(`[AI Service] Trying model ${i + 1}/${this.models.length}: ${model}`);
        
        const completion = await this.groq.chat.completions.create({
          messages: messages,
          model: model,
          temperature: 0.7,
          max_tokens: 500,
          top_p: 1,
          stream: false
        });

        console.log(`[AI Service] Success with model: ${model}`);
        const response = completion.choices[0]?.message?.content || "I'm not sure how to respond to that.";
        return `🤖 ${response}`;
        
      } catch (error) {
        console.error(`[AI Service] Error with model ${model}:`, error);
        
        if (error instanceof Error) {
          // If it's the last model, return the error
          if (i === this.models.length - 1) {
            console.error('[AI Service] All models failed, returning error message');
            
            if (error.message.includes('rate_limit')) {
              return "🤖 I'm getting too many requests right now. Please try again in a moment.";
            } else if (error.message.includes('invalid_api_key') || error.message.includes('401')) {
              return "🤖 There's an issue with my API key configuration. Please contact the administrator.";
            } else if (error.message.includes('network') || error.message.includes('timeout')) {
              return "🤖 I'm having network connectivity issues. Please try again later.";
            } else if (error.message.includes('model_decommissioned') || error.message.includes('model')) {
              return "🤖 The AI models are currently unavailable. Please try again later.";
            }
            
            return "🤖 Sorry, I'm having trouble responding right now. Please try again later.";
          }
          
          // Continue to next model if current one fails
          console.log(`[AI Service] Trying next model due to error: ${error.message}`);
        }
      }
    }

    return "🤖 Sorry, all AI models are currently unavailable. Please try again later.";
  }
  public isAvailable(): boolean {
    return this.isInitialized && this.groq !== null;
  }
  public async testConnection(): Promise<boolean> {
    if (!this.isAvailable()) {
      console.log('[AI Service] Service not available for testing');
      return false;
    }

    try {
      console.log('[AI Service] Testing connection with first available model...');
      await this.groq!.chat.completions.create({
        messages: [{ role: 'user', content: 'Hello' }],
        model: this.models[0],
        max_tokens: 10
      });
      
      console.log('[AI Service] Connection test successful');
      return true;
    } catch (error) {
      console.error('[AI Service] Connection test failed:', error);
      return false;
    }
  }
}

// Export a singleton instance
export const aiService = new AIService();

// Test the connection on startup
aiService.testConnection().then((success) => {
  if (success) {
    console.log('[AI Service] Startup test successful - AI chat is ready');
  } else {
    console.log('[AI Service] Startup test failed - AI chat may not work properly');
  }
}).catch((error) => {
  console.error('[AI Service] Startup test error:', error);
});
