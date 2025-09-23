import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Send, Mic, Paperclip } from "lucide-react";

interface SearchInputProps {
  onSubmit: (query: string) => void;
  placeholder: string;
  disabled?: boolean;
}

export function SearchInput({ onSubmit, placeholder, disabled = false }: SearchInputProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSubmit(query.trim());
      setQuery("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center space-x-2">
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="pr-24 pl-4 py-3 bg-input-background border-0 focus:ring-2 focus:ring-primary/20 rounded-xl"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="w-8 h-8 hover:bg-accent"
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="w-8 h-8 hover:bg-accent"
            >
              <Mic className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <Button
          type="submit"
          disabled={!query.trim() || disabled}
          className="px-4 py-3 rounded-xl bg-[#fff38D] hover:bg-[#fff38D]/90 text-[#464646] border-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </form>
  );
}