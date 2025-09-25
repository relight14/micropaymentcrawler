import { Avatar, AvatarFallback } from "./ui/avatar";
import { Card } from "./ui/card";
import { SourceCard } from "./SourceCard";
import { Bot, User } from "lucide-react";

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

interface MessageBubbleProps {
  message: string;
  isUser: boolean;
  timestamp: Date;
  sources?: Source[];
}

export function MessageBubble({ message, isUser, timestamp, sources }: MessageBubbleProps) {
  return (
    <div className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}>
      <Avatar className="w-8 h-8">
        <AvatarFallback className={`${isUser ? 'bg-[#464646]' : 'bg-[#fff38D]'} text-white`}>
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-gray-800" />}
        </AvatarFallback>
      </Avatar>
      
      <div className={`flex-1 max-w-[80%] ${isUser ? 'flex justify-end' : ''}`}>
        <div className="space-y-4">
          <Card className={`p-4 ${
            isUser 
              ? 'bg-[#fff38D] text-[#464646] border-0' 
              : 'bg-card border-border'
          }`}>
            <p className="whitespace-pre-wrap">{message}</p>
            <p className={`text-xs mt-2 ${
              isUser ? 'text-gray-600' : 'text-muted-foreground'
            }`}>
              {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </Card>
          
          {sources && sources.length > 0 && (
            <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-1">
              {sources.map((source) => (
                <SourceCard key={source.id} {...source} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}