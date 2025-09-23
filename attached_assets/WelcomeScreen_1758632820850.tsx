import { Button } from "./ui/button";
import { Search } from "lucide-react";

interface WelcomeScreenProps {
  onStartSearch: () => void;
}

export function WelcomeScreen({ onStartSearch }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl mx-auto text-center space-y-8">
        {/* Main Content */}
        <div className="space-y-6">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Smarter Search Starts Here
          </h1>
          
          <div className="space-y-4">
            <h2 className="text-xl md:text-2xl text-muted-foreground">
              Tap into the world's most relevant, high-quality content — ethically licensed, expertly summarized, and available on demand.
            </h2>
            
            <p className="text-lg text-muted-foreground">
              Just ask a question — we'll find, license, and synthesize the best information on the web.
            </p>
          </div>
        </div>

        {/* CTA Button */}
        <div className="space-y-4">
          <Button
            onClick={onStartSearch}
            size="lg"
            className="px-8 py-4 text-lg bg-gradient-to-r from-blue-500 to-[#fff38D] hover:from-blue-600 hover:to-[#fff38D]/90 text-gray-800 border-0 font-semibold"
          >
            🔎 Start Your Search
          </Button>
          
          <p className="text-sm text-muted-foreground">
            No subscriptions. Just pay for what you unlock.
          </p>
        </div>

        {/* Trust Tagline */}
        <div className="pt-8 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Built with publishers in mind. Powered by LedeWire Wallets.
          </p>
        </div>

        {/* Visual Elements */}
        <div className="flex items-center justify-center space-x-8 pt-8 opacity-60">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#fff38D] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
        </div>
      </div>
    </div>
  );
}