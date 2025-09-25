import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Search, MessageCircle, Settings, User } from "lucide-react";
import logo from 'figma:asset/9b2448b1ae9033f8f32366c4913371defc360b42.png';

interface HeaderProps {
  mode: 'chat' | 'research';
  onModeChange: (mode: 'chat' | 'research') => void;
  darkMode: boolean;
  onDarkModeToggle: () => void;
}

export function Header({ mode, onModeChange, darkMode, onDarkModeToggle }: HeaderProps) {
  return (
    <header className="bg-background/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo Only */}
          <div className="flex items-center">
            <img 
              src={logo} 
              alt="LedeWire Logo" 
              className="h-8 w-auto dark:invert"
            />
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center space-x-2 bg-muted rounded-lg p-1">
            <Button
              variant={mode === 'chat' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onModeChange('chat')}
              className="flex items-center space-x-2"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Chat</span>
            </Button>
            <Button
              variant={mode === 'research' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onModeChange('research')}
              className="flex items-center space-x-2"
            >
              <Search className="w-4 h-4" />
              <span>Research</span>
            </Button>
          </div>

          {/* Controls */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">Dark</span>
              <Switch
                checked={darkMode}
                onCheckedChange={onDarkModeToggle}
              />
            </div>
            <Button variant="ghost" size="icon">
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon">
              <User className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}