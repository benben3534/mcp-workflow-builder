#!/usr/bin/env node

/**
 * MCP Server for Automated Workflow Builder
 * Connects Claude to n8n, Airtable, OpenAI, and Telegram for automatic workflow creation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import OpenAI from 'openai';

// Configuration interfaces
interface N8nConfig {
  baseUrl: string;
  apiKey: string;
}

interface AirtableConfig {
  apiKey: string;
  baseId: string;
}

interface OpenAIConfig {
  apiKey: string;
}

interface TelegramConfig {
  botToken: string;
}

interface WorkflowConfig {
  name: string;
  description: string;
  trigger?: any;
  nodes: any[];
  connections: { [key: string]: any };
}

class WorkflowBuilderMCP {
  private server: Server;
  private n8nConfig: N8nConfig;
  private airtableConfig: AirtableConfig;
  private openaiConfig: OpenAIConfig;
  private telegramConfig: TelegramConfig;
  private openai: OpenAI;

  constructor() {
    this.server = new Server({
      name: 'workflow-builder-mcp',
      version: '1.0.0',
    });

    // Load configuration from environment variables
    this.n8nConfig = {
      baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
      apiKey: process.env.N8N_API_KEY || '',
    };

    this.airtableConfig = {
      apiKey: process.env.AIRTABLE_API_KEY || '',
      baseId: process.env.AIRTABLE_BASE_ID || '',
    };

    this.openaiConfig = {
      apiKey: process.env.OPENAI_API_KEY || '',
    };

    this.telegramConfig = {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    };

    this.openai = new OpenAI({
      apiKey: this.openaiConfig.apiKey,
    });

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'create_workflow',
            description: 'Create a new workflow in n8n based on description',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the workflow',
                },
                description: {
                  type: 'string',
                  description: 'Description of what the workflow should do',
                },
                requirements: {
                  type: 'object',
                  description: 'Specific requirements and parameters for the workflow',
                },
              },
              required: ['name', 'description'],
            },
          },
          {
            name: 'get_airtable_schema',
            description: 'Get schema information from Airtable base',
            inputSchema: {
              type: 'object',
              properties: {
                tableId: {
                  type: 'string',
                  description: 'Airtable table ID (optional)',
                },
              },
            },
          },
          {
            name: 'get_n8n_workflows',
            description: 'List existing workflows in n8n',
            inputSchema: {
              type: 'object',
              properties: {
                active: {
                  type: 'boolean',
                  description: 'Filter by active status',
                },
              },
            },
          },
          {
            name: 'analyze_workflow_requirements',
            description: 'Analyze natural language requirements and suggest workflow structure',
            inputSchema: {
              type: 'object',
              properties: {
                requirements: {
                  type: 'string',
                  description: 'Natural language description of workflow requirements',
                },
                context: {
                  type: 'object',
                  description: 'Additional context like existing data sources, APIs, etc.',
                },
              },
              required: ['requirements'],
            },
          },
          {
            name: 'generate_with_chatgpt',
            description: 'Generate content or analyze text using ChatGPT',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The prompt to send to ChatGPT',
                },
                model: {
                  type: 'string',
                  description: 'GPT model to use (gpt-4, gpt-3.5-turbo)',
                  default: 'gpt-3.5-turbo',
                },
                max_tokens: {
                  type: 'number',
                  description: 'Maximum tokens in response',
                  default: 1000,
                },
              },
              required: ['prompt'],
            },
          },
          {
            name: 'send_telegram_message',
            description: 'Send a message via Telegram bot',
            inputSchema: {
              type: 'object',
              properties: {
                chat_id: {
                  type: 'string',
                  description: 'Telegram chat ID to send message to',
                },
                message: {
                  type: 'string',
                  description: 'Message text to send',
                },
                parse_mode: {
                  type: 'string',
                  description: 'Message formatting (HTML, Markdown)',
                  default: 'HTML',
                },
              },
              required: ['chat_id', 'message'],
            },
          },
          {
            name: 'get_telegram_updates',
            description: 'Get recent messages from Telegram bot',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Number of updates to retrieve',
                  default: 10,
                },
              },
            },
          },
          {
            name: 'improve_workflow_with_ai',
            description: 'Use AI to improve and optimize workflow descriptions and logic',
            inputSchema: {
              type: 'object',
              properties: {
                workflow_description: {
                  type: 'string',
                  description: 'Current workflow description to improve',
                },
                goal: {
                  type: 'string',
                  description: 'What aspect to improve (efficiency, clarity, functionality, etc.)',
                },
              },
              required: ['workflow_description'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_workflow':
            return await this.createWorkflow(args as any);
          case 'get_airtable_schema':
            return await this.getAirtableSchema(args as any);
          case 'get_n8n_workflows':
            return await this.getN8nWorkflows(args as any);
          case 'analyze_workflow_requirements':
            return await this.analyzeWorkflowRequirements(args as any);
          case 'generate_with_chatgpt':
            return await this.generateWithChatGPT(args as any);
          case 'send_telegram_message':
            return await this.sendTelegramMessage(args as any);
          case 'get_telegram_updates':
            return await this.getTelegramUpdates(args as any);
          case 'improve_workflow_with_ai':
            return await this.improveWorkflowWithAI(args as any);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private async createWorkflow(args: any) {
    const { name, description, requirements = {} } = args;

    try {
      // Use AI to enhance the workflow description
      const enhancedDescription = await this.enhanceWorkflowDescription(description, requirements);
      
      // Analyze requirements and build workflow structure
      const workflowStructure = await this.buildWorkflowStructure(enhancedDescription, requirements);

      // Create workflow in n8n
      const workflow = await this.createN8nWorkflow({
        name,
        description: enhancedDescription,
        nodes: workflowStructure.nodes,
        connections: workflowStructure.connections,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Workflow "${name}" created successfully!\n\nWorkflow ID: ${workflow.id}\nStatus: ${workflow.active ? 'Active' : 'Inactive'}\n\nEnhanced Description: ${enhancedDescription}\n\nStructure:\n${JSON.stringify(workflowStructure, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  }

  private async enhanceWorkflowDescription(description: string, requirements: any): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert workflow automation consultant. Enhance workflow descriptions to be more detailed, specific, and actionable while keeping them concise. Focus on clear steps and integration points.',
          },
          {
            role: 'user',
            content: `Please enhance this workflow description to be more detailed and specific:\n\nOriginal: ${description}\n\nRequirements: ${JSON.stringify(requirements)}\n\nProvide only the enhanced description, no additional commentary.`,
          },
        ],
        max_tokens: 500,
      });

      return completion.choices[0].message.content || description;
    } catch (error) {
      console.error('Error enhancing workflow description:', error);
      return description; // Fall back to original description
    }
  }

  private async buildWorkflowStructure(description: string, requirements: any) {
    const nodes: any[] = [];
    const connections: { [key: string]: any } = {};
    let nodeCounter = 0;

    // Start with a trigger node
    const triggerNode = {
      id: `node_${nodeCounter++}`,
      name: 'Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [250, 300],
      parameters: {},
    };
    nodes.push(triggerNode);

    // Analyze description for common patterns
    if (description.toLowerCase().includes('airtable')) {
      const airtableNode = {
        id: `node_${nodeCounter++}`,
        name: 'Airtable',
        type: 'n8n-nodes-base.airtable',
        typeVersion: 1,
        position: [450, 300],
        parameters: {
          authentication: 'airtableApi',
          operation: 'list',
          application: this.airtableConfig.baseId,
          table: requirements.tableId || 'tblExample',
        },
      };
      nodes.push(airtableNode);

      // Connect trigger to airtable
      connections[triggerNode.name] = {
        main: [[{ node: airtableNode.name, type: 'main', index: 0 }]],
      };
    }

    // Add ChatGPT node if AI processing is mentioned
    if (description.toLowerCase().includes('ai') || description.toLowerCase().includes('gpt') || description.toLowerCase().includes('analyze') || description.toLowerCase().includes('generate')) {
      const chatgptNode = {
        id: `node_${nodeCounter++}`,
        name: 'ChatGPT',
        type: 'n8n-nodes-base.openAi',
        typeVersion: 1,
        position: [650, 300],
        parameters: {
          operation: 'chat',
          model: 'gpt-3.5-turbo',
          messages: {
            values: [
              {
                role: 'user',
                content: requirements.aiPrompt || 'Process the input data and provide insights.',
              },
            ],
          },
        },
      };
      nodes.push(chatgptNode);

      // Connect to ChatGPT
      if (nodes.length > 1) {
        const lastNode = nodes[nodes.length - 2];
        if (!connections[lastNode.name]) {
          connections[lastNode.name] = { main: [] };
        }
        connections[lastNode.name].main.push([{ node: chatgptNode.name, type: 'main', index: 0 }]);
      }
    }

    // Add Telegram node if messaging is mentioned
    if (description.toLowerCase().includes('telegram') || description.toLowerCase().includes('message') || description.toLowerCase().includes('notify')) {
      const telegramNode = {
        id: `node_${nodeCounter++}`,
        name: 'Telegram',
        type: 'n8n-nodes-base.telegram',
        typeVersion: 1,
        position: [850, 300],
        parameters: {
          operation: 'sendMessage',
          chatId: requirements.telegramChatId || '@channel',
          text: requirements.telegramMessage || 'Workflow notification from n8n',
        },
      };
      nodes.push(telegramNode);

      // Connect to Telegram
      if (nodes.length > 1) {
        const lastNode = nodes[nodes.length - 2];
        if (!connections[lastNode.name]) {
          connections[lastNode.name] = { main: [] };
        }
        connections[lastNode.name].main.push([{ node: telegramNode.name, type: 'main', index: 0 }]);
      }
    }

    if (description.toLowerCase().includes('email')) {
      const emailNode = {
        id: `node_${nodeCounter++}`,
        name: 'Send Email',
        type: 'n8n-nodes-base.emailSend',
        typeVersion: 1,
        position: [1050, 300],
        parameters: {
          fromEmail: requirements.fromEmail || 'noreply@example.com',
          toEmail: requirements.toEmail || 'user@example.com',
          subject: requirements.subject || 'Workflow Notification',
          text: requirements.message || 'Workflow executed successfully',
        },
      };
      nodes.push(emailNode);

      // Connect last node to email
      if (nodes.length > 1) {
        const lastNode = nodes[nodes.length - 2];
        if (!connections[lastNode.name]) {
          connections[lastNode.name] = { main: [] };
        }
        connections[lastNode.name].main.push([{ node: emailNode.name, type: 'main', index: 0 }]);
      }
    }

    return {
      nodes,
      connections,
    };
  }

  private async createN8nWorkflow(config: WorkflowConfig) {
    const response = await axios.post(
      `${this.n8nConfig.baseUrl}/api/v1/workflows`,
      {
        name: config.name,
        nodes: config.nodes,
        connections: config.connections,
        active: false,
        settings: {},
        tags: ['auto-generated', 'mcp-builder'],
      },
      {
        headers: {
          'X-N8N-API-KEY': this.n8nConfig.apiKey,  // FIXED: Changed from Authorization to X-N8N-API-KEY
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  private async sendTelegramMessage(args: any) {
    const { chat_id, message, parse_mode = 'HTML' } = args;

    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${this.telegramConfig.botToken}/sendMessage`,
        {
          chat_id: chat_id,
          text: message,
          parse_mode: parse_mode,
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: `Message sent successfully to Telegram!\n\nResponse: ${JSON.stringify(response.data, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error sending Telegram message: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  }

  private async getTelegramUpdates(args: any) {
    const { limit = 10 } = args;

    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${this.telegramConfig.botToken}/getUpdates`,
        {
          params: {
            limit: limit,
          },
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: `Recent Telegram Updates:\n\n${JSON.stringify(response.data, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting Telegram updates: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  }

  private async getAirtableSchema(args: any) {
    const { tableId } = args;
    
    try {
      // Get base schema
      const baseResponse = await axios.get(
        `https://api.airtable.com/v0/meta/bases/${this.airtableConfig.baseId}/tables`,
        {
          headers: {
            Authorization: `Bearer ${this.airtableConfig.apiKey}`,
          },
        }
      );

      const tables = baseResponse.data.tables;
      
      if (tableId) {
        const table = tables.find((t: any) => t.id === tableId);
        return {
          content: [
            {
              type: 'text',
              text: `Table Schema:\n${JSON.stringify(table, null, 2)}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Airtable Base Schema:\n${JSON.stringify({ tables: tables.map((t: any) => ({ id: t.id, name: t.name, fields: t.fields })) }, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get Airtable schema: ${error}`);
    }
  }

  private async getN8nWorkflows(args: any) {
    const { active } = args;
    
    try {
      let url = `${this.n8nConfig.baseUrl}/api/v1/workflows`;
      if (active !== undefined) {
        url += `?active=${active}`;
      }

      const response = await axios.get(url, {
        headers: {
          'X-N8N-API-KEY': this.n8nConfig.apiKey,  // FIXED: Changed from Authorization to X-N8N-API-KEY
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `N8N Workflows:\n${JSON.stringify(response.data, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get n8n workflows: ${error}`);
    }
  }

  private async generateWithChatGPT(args: any) {
    const { prompt, model = 'gpt-3.5-turbo', max_tokens = 1000 } = args;

    try {
      const completion = await this.openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: max_tokens,
      });

      return {
        content: [
          {
            type: 'text',
            text: completion.choices[0].message.content || 'No response from ChatGPT',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling ChatGPT: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  }

  private async improveWorkflowWithAI(args: any) {
    const { workflow_description, goal = 'improve efficiency and clarity' } = args;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert workflow automation consultant specializing in n8n, Airtable, Telegram, and business process optimization. Provide specific, actionable improvements.',
          },
          {
            role: 'user',
            content: `Please analyze and improve this workflow description to ${goal}:\n\n${workflow_description}\n\nProvide:\n1. Improved workflow description\n2. Specific optimization suggestions\n3. Potential integration points (Airtable, Telegram, AI)\n4. Error handling recommendations`,
          },
        ],
        max_tokens: 1500,
      });

      return {
        content: [
          {
            type: 'text',
            text: completion.choices[0].message.content || 'No improvements suggested',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error improving workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  }

  private async analyzeWorkflowRequirements(args: any) {
    const { requirements, context = {} } = args;

    try {
      const aiAnalysis = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a workflow analysis expert. Analyze the requirements and provide structured insights about triggers, actions, data flow, and integrations needed. Consider n8n, Airtable, Telegram, and AI capabilities.',
          },
          {
            role: 'user',
            content: `Analyze these workflow requirements:\n\n${requirements}\n\nContext: ${JSON.stringify(context)}\n\nProvide a JSON response with: triggers, actions, dataFlow, integrations, complexity, estimatedNodes, and recommendations.`,
          },
        ],
        max_tokens: 800,
      });

      let aiResult;
      try {
        aiResult = JSON.parse(aiAnalysis.choices[0].message.content || '{}');
      } catch {
        aiResult = { aiInsight: aiAnalysis.choices[0].message.content };
      }

      const analysis = {
        triggers: this.extractTriggers(requirements),
        actions: this.extractActions(requirements),
        dataFlow: this.extractDataFlow(requirements),
        integrations: this.extractIntegrations(requirements),
        conditions: this.extractConditions(requirements),
        suggestedStructure: this.suggestWorkflowStructure(requirements, context),
        aiEnhanced: aiResult,
      };

      return {
        content: [
          {
            type: 'text',
            text: `Workflow Requirements Analysis:\n${JSON.stringify(analysis, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      const analysis = {
        triggers: this.extractTriggers(requirements),
        actions: this.extractActions(requirements),
        dataFlow: this.extractDataFlow(requirements),
        integrations: this.extractIntegrations(requirements),
        conditions: this.extractConditions(requirements),
        suggestedStructure: this.suggestWorkflowStructure(requirements, context),
        error: `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };

      return {
        content: [
          {
            type: 'text',
            text: `Workflow Requirements Analysis (Rule-based):\n${JSON.stringify(analysis, null, 2)}`,
          },
        ],
      };
    }
  }

  private extractTriggers(requirements: string): string[] {
    const triggers: string[] = [];
    const triggerPatterns = [
      /when\s+(.+?)(?:\s+then|\s+,|\s+\.|$)/gi,
      /on\s+(.+?)(?:\s+then|\s+,|\s+\.|$)/gi,
      /if\s+(.+?)(?:\s+then|\s+,|\s+\.|$)/gi,
      /trigger\s+on\s+(.+?)(?:\s+then|\s+,|\s+\.|$)/gi,
    ];

    triggerPatterns.forEach(pattern => {
      const matches = requirements.match(pattern);
      if (matches) {
        triggers.push(...matches);
      }
    });

    return triggers;
  }

  private extractActions(requirements: string): string[] {
    const actions: string[] = [];
    const actionPatterns = [
      /then\s+(.+?)(?:\s+and|\s+,|\s+\.|$)/gi,
      /send\s+(.+?)(?:\s+to|\s+,|\s+\.|$)/gi,
      /create\s+(.+?)(?:\s+in|\s+,|\s+\.|$)/gi,
      /update\s+(.+?)(?:\s+in|\s+,|\s+\.|$)/gi,
      /notify\s+(.+?)(?:\s+via|\s+,|\s+\.|$)/gi,
    ];

    actionPatterns.forEach(pattern => {
      const matches = requirements.match(pattern);
      if (matches) {
        actions.push(...matches);
      }
    });

    return actions;
  }

  private extractDataFlow(requirements: string): any {
    return {
      sources: this.extractDataSources(requirements),
      transformations: this.extractTransformations(requirements),
      destinations: this.extractDestinations(requirements),
    };
  }

  private extractDataSources(requirements: string): string[] {
    const sources: string[] = [];
    if (requirements.toLowerCase().includes('airtable')) sources.push('airtable');
    if (requirements.toLowerCase().includes('google sheets')) sources.push('googleSheets');
    if (requirements.toLowerCase().includes('webhook')) sources.push('webhook');
    if (requirements.toLowerCase().includes('email')) sources.push('email');
    if (requirements.toLowerCase().includes('telegram')) sources.push('telegram');
    if (requirements.toLowerCase().includes('api')) sources.push('api');
    return sources;
  }

  private extractTransformations(requirements: string): string[] {
    const transformations: string[] = [];
    if (requirements.toLowerCase().includes('filter')) transformations.push('filter');
    if (requirements.toLowerCase().includes('format')) transformations.push('format');
    if (requirements.toLowerCase().includes('convert')) transformations.push('convert');
    if (requirements.toLowerCase().includes('calculate')) transformations.push('calculate');
    if (requirements.toLowerCase().includes('ai') || requirements.toLowerCase().includes('gpt')) transformations.push('ai-processing');
    if (requirements.toLowerCase().includes('analyze')) transformations.push('analyze');
    return transformations;
  }

  private extractDestinations(requirements: string): string[] {
    const destinations: string[] = [];
    if (requirements.toLowerCase().includes('email')) destinations.push('email');
    if (requirements.toLowerCase().includes('slack')) destinations.push('slack');
    if (requirements.toLowerCase().includes('telegram')) destinations.push('telegram');
    if (requirements.toLowerCase().includes('database')) destinations.push('database');
    if (requirements.toLowerCase().includes('api')) destinations.push('api');
    if (requirements.toLowerCase().includes('airtable')) destinations.push('airtable');
    return destinations;
  }

  private extractIntegrations(requirements: string): string[] {
    const integrations = ['airtable']; // Always include Airtable
    if (requirements.toLowerCase().includes('slack')) integrations.push('slack');
    if (requirements.toLowerCase().includes('google')) integrations.push('google');
    if (requirements.toLowerCase().includes('email')) integrations.push('email');
    if (requirements.toLowerCase().includes('telegram')) integrations.push('telegram');
    if (requirements.toLowerCase().includes('ai') || requirements.toLowerCase().includes('gpt')) integrations.push('openai');
    return [...new Set(integrations)];
  }

  private extractConditions(requirements: string): string[] {
    const conditions: string[] = [];
    const conditionPatterns = [
      /if\s+(.+?)(?:\s+then)/gi,
      /when\s+(.+?)(?:\s+is|=|>|<)/gi,
      /only\s+if\s+(.+?)(?:\s+then|\s+,|\s+\.|$)/gi,
    ];

    conditionPatterns.forEach(pattern => {
      const matches = requirements.match(pattern);
      if (matches) {
        conditions.push(...matches);
      }
    });

    return conditions;
  }

  private suggestWorkflowStructure(requirements: string, context: any): any {
    return {
      complexity: this.assessComplexity(requirements),
      estimatedNodes: this.estimateNodeCount(requirements),
      recommendedApproach: this.recommendApproach(requirements),
      dependencies: this.identifyDependencies(requirements, context),
    };
  }

  private assessComplexity(requirements: string): string {
    const complexityIndicators = [
      'multiple conditions',
      'loop',
      'iteration',
      'complex logic',
      'multiple integrations',
      'ai processing',
      'data transformation',
      'telegram bot',
      'real-time',
    ];
    
    const foundIndicators = complexityIndicators.filter(indicator =>
      requirements.toLowerCase().includes(indicator)
    );

    if (foundIndicators.length >= 3) return 'high';
    if (foundIndicators.length >= 1) return 'medium';
    return 'low';
  }

  private estimateNodeCount(requirements: string): number {
    let count = 1; // Start with trigger
    
    // Count likely integrations
    if (requirements.toLowerCase().includes('airtable')) count++;
    if (requirements.toLowerCase().includes('email')) count++;
    if (requirements.toLowerCase().includes('slack')) count++;
    if (requirements.toLowerCase().includes('telegram')) count++;
    if (requirements.toLowerCase().includes('webhook')) count++;
    if (requirements.toLowerCase().includes('ai') || requirements.toLowerCase().includes('gpt')) count++;
    
    // Add for conditions
    const conditionCount = (requirements.match(/if\s+/gi) || []).length;
    count += conditionCount;
    
    // Add for loops
    const loopCount = (requirements.match(/for\s+each|loop/gi) || []).length;
    count += loopCount * 2; // Loops typically need multiple nodes
    
    return count;
  }

  private recommendApproach(requirements: string): string {
    if (requirements.toLowerCase().includes('real-time')) {
      return 'webhook-triggered';
    }
    if (requirements.toLowerCase().includes('schedule') || requirements.toLowerCase().includes('daily')) {
      return 'cron-triggered';
    }
    if (requirements.toLowerCase().includes('telegram')) {
      return 'telegram-bot-triggered';
    }
    if (requirements.toLowerCase().includes('ai') || requirements.toLowerCase().includes('gpt')) {
      return 'ai-enhanced-processing';
    }
    return 'manual-triggered';
  }

  private identifyDependencies(requirements: string, context: any): string[] {
    const dependencies: string[] = [];
    
    if (requirements.toLowerCase().includes('airtable')) {
      dependencies.push('airtable-credentials');
    }
    if (requirements.toLowerCase().includes('email')) {
      dependencies.push('smtp-configuration');
    }
    if (requirements.toLowerCase().includes('slack')) {
      dependencies.push('slack-app-credentials');
    }
    if (requirements.toLowerCase().includes('telegram')) {
      dependencies.push('telegram-bot-token');
    }
    if (requirements.toLowerCase().includes('ai') || requirements.toLowerCase().includes('gpt')) {
      dependencies.push('openai-api-key');
    }
    
    return dependencies;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Workflow Builder MCP server running on stdio');
  }
}

// Run the server
const server = new WorkflowBuilderMCP();
server.run().catch(console.error);