import { FileText } from "lucide-react";
import { Button } from "./ui/button";
import ledeWireLogo from 'figma:asset/9b2448b1ae9033f8f32366c4913371defc360b42.png';

interface ReportHeaderProps {
  title: string;
  date: string;
  query: string;
}

export function ReportHeader({ title, date, query }: ReportHeaderProps) {
  return (
    <div className="space-y-4">
      {/* Logo Header */}
      <div className="flex items-center justify-center p-4 border-b border-border">
        <img 
          src={ledeWireLogo} 
          alt="LedeWire" 
          className="h-8"
        />
      </div>
      
      {/* Report Info */}
      <div className="flex items-center justify-between px-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="font-sans font-medium">{title}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{date}</span>
              <span>Query: "{query}"</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm">
            Save to my Library
          </Button>
        </div>
      </div>
    </div>
  );
}