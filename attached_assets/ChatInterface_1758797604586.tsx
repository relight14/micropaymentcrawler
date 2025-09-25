import { useState, useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble";
import { SearchInput } from "./SearchInput";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { SourceCard } from "./SourceCard";
import { ResearchPackets } from "./ResearchPackets";
import { RotateCcw, Sparkles } from "lucide-react";

interface Source {
  id: string;
  title: string;
  url: string;
  summary: string;
  sourceType: string;
  licenseType: 'free' | 'paid' | 'premium';
  price?: number;
  rating?: number;
  publishDate: string;
  author: string;
}

interface Message {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
  sources?: Source[];
}

interface ChatInterfaceProps {
  mode: 'chat' | 'research';
}

export function ChatInterface({ mode }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      content,
      isUser: true,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: mode === 'research' ? generateResearchResponse(content) : generateAIResponse(content),
        isUser: false,
        timestamp: new Date(),
        sources: mode === 'research' ? generateResearchSources(content) : undefined
      };
      setMessages(prev => [...prev, aiResponse]);
      setIsLoading(false);
    }, 2000);
  };

  const generateAIResponse = (query: string): string => {
    const responses = [
      `Great question about "${query}"! Based on my analysis, I can provide you with comprehensive insights. Here are the key points:\n\n• This topic involves multiple interconnected concepts\n• Recent research shows significant developments\n• There are several practical applications you should consider\n\nWould you like me to dive deeper into any specific aspect, or shall I switch to research mode to find you some authoritative sources?`,
      
      `I understand you're interested in "${query}". This is a fascinating area with lots of recent developments. Let me break this down:\n\n• Current state of the field\n• Key challenges and opportunities\n• Practical implications\n\nI can also search for specific papers, articles, or reports on this topic if you'd like to switch to research mode. What aspect interests you most?`,
      
      `Excellent question about "${query}"! From my knowledge base, I can tell you that:\n\n• This field has evolved significantly in recent years\n• There are several competing theories and approaches\n• The practical applications are quite promising\n\nI notice this might benefit from some current research. Would you like me to find recent publications and authoritative sources on this topic?`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  };

  const generateResearchResponse = (query: string): string => {
    return `I found several relevant sources for \"${query}\". Here are the top results with licensing options:`;
  };

  const generateResearchSources = (query: string): Source[] => {
    return [
      {
        id: '1',
        title: `Comprehensive Analysis of ${query}: Current Trends and Future Implications`,
        url: 'https://example.com/research1',
        summary: `This comprehensive study examines the current state of ${query} research, analyzing recent developments and their potential impact on future applications. The paper includes detailed statistical analysis and expert interviews.`,
        sourceType: 'Academic Paper',
        licenseType: 'free',
        rating: 4.8,
        publishDate: '2024-01-15',
        author: 'Dr. Sarah Chen et al.'
      },
      {
        id: '2',
        title: `${query} Market Report 2024: Industry Insights and Strategic Recommendations`,
        url: 'https://example.com/report2',
        summary: `Professional market analysis providing strategic insights into ${query} industry trends, market dynamics, and growth opportunities. Includes exclusive data and expert forecasts.`,
        sourceType: 'Industry Report',
        licenseType: 'paid',
        price: 299,
        rating: 4.6,
        publishDate: '2024-02-28',
        author: 'Strategic Analytics Corp'
      },
      {
        id: '3',
        title: `Advanced ${query} Techniques: A Practitioner's Guide`,
        url: 'https://example.com/guide3',
        summary: `Practical guide covering advanced techniques and best practices in ${query}. Written by industry experts with real-world case studies and implementation strategies.`,
        sourceType: 'Professional Guide',
        licenseType: 'premium',
        price: 149,
        rating: 4.9,
        publishDate: '2024-03-10',
        author: 'Expert Consulting Group'
      }
    ];
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h2 className="font-semibold">LedeWire Research Assistant</h2>
          <p className="text-sm text-muted-foreground">
            {mode === 'research' ? 'Research Mode - Find & License Sources' : 'Chat Mode - AI Conversations'}
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearChat}
            className="flex items-center space-x-2"
          >
            <RotateCcw className="w-4 h-4" />
            <span>New Chat</span>
          </Button>
        )}
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-6 max-w-4xl mx-auto">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-16 h-16 bg-[#fff38D] rounded-lg flex items-center justify-center mb-6 shadow-sm">
                <Sparkles className="w-8 h-8 text-[#464646]" />
              </div>
              <h3 className="text-2xl font-semibold mb-4 text-[#464646]">Smarter Search Starts Here</h3>
              <p className="text-lg text-[#464646]/70 mb-2 max-w-xl">
                Tap into the world's most relevant, high-quality content — ethically licensed, expertly summarized, and available on demand.
              </p>
              <p className="text-[#464646]/60 mb-8">
                Just ask a question — we'll find, license, and synthesize the best information on the web.
              </p>
              <p className="text-xs text-[#464646]/50">
                Built with publishers in mind. Powered by LedeWire Wallets.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message.content}
              isUser={message.isUser}
              timestamp={message.timestamp}
              sources={message.sources}
            />
          ))}
          
          {/* Show research packets after research results */}
          {mode === 'research' && messages.some(msg => !msg.isUser && msg.sources) && !isLoading && (
            <div className="mt-8">
              <ResearchPackets />
            </div>
          )}
          
          {isLoading && (
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-[#fff38D] rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-gray-800 rounded-full animate-pulse" />
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-background/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <SearchInput
            onSubmit={handleSendMessage}
            placeholder={messages.length === 0 ? "🔎 Start your search..." : "Ask me anything..."}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}