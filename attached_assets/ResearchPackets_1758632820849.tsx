import { Card, CardContent, CardHeader } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Check, Crown, Star, Zap } from "lucide-react";

export function ResearchPackets() {
  const packets = [
    {
      id: 'basic',
      name: 'Basic Tier',
      price: 'Free',
      icon: Star,
      description: 'Up to 10 licensed premium sources',
      subtitle: 'Free research with quality sources and professional analysis',
      features: [
        'Up to 10 licensed premium sources',
        'Professional analysis',
        'Quality source verification',
        'Basic summarization'
      ],
      buttonText: 'Get Started',
      highlighted: false,
      ctaClass: 'bg-[#464646] hover:bg-[#464646]/90 text-white'
    },
    {
      id: 'research',
      name: 'Research Tier',
      price: '$0.99',
      icon: Zap,
      description: 'Up to 20 licensed sources + expert outline',
      subtitle: 'Craving clarity on this topic? For $0.99, we\'ll ethically license and distill the web\'s most relevant sources into a single, powerful summary.',
      features: [
        'Up to 20 licensed sources',
        'Expert research outline',
        'Advanced summarization',
        'Source credibility analysis',
        'Topic deep-dive'
      ],
      buttonText: 'Unlock Research',
      highlighted: true,
      ctaClass: 'bg-[#fff38D] hover:bg-[#fff38D]/90 text-[#464646]'
    },
    {
      id: 'pro',
      name: 'Pro Tier',
      price: '$1.99',
      icon: Crown,
      description: 'Up to 40 licensed sources + expert outline + strategic insights',
      subtitle: 'Serious about answers? Our Pro tier delivers full-spectrum research — licensed sources, competitive intelligence, and strategic framing.',
      features: [
        'Up to 40 licensed sources',
        'Expert research outline',
        'Strategic insights & framing',
        'Competitive intelligence',
        'Executive summary',
        'Actionable recommendations'
      ],
      buttonText: 'Unlock Pro',
      highlighted: false,
      ctaClass: 'bg-[#464646] hover:bg-[#464646]/90 text-white'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">Research Packages</h3>
        <p className="text-muted-foreground">
          Get comprehensive research bundles with licensed content and expert analysis
        </p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-3">
        {packets.map((packet) => {
          const IconComponent = packet.icon;
          
          return (
            <Card 
              key={packet.id} 
              className={`relative hover:shadow-lg transition-all duration-200 ${
                packet.highlighted 
                  ? 'border-[#fff38D] shadow-md ring-1 ring-[#fff38D]/20' 
                  : 'border-border'
              }`}
            >
              {packet.highlighted && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-[#fff38D] text-[#464646] px-3 py-1">
                    Most Popular
                  </Badge>
                </div>
              )}
              
              <CardHeader className="text-center pb-4">
                <div className="flex flex-col items-center space-y-3">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    packet.highlighted 
                      ? 'bg-[#fff38D]' 
                      : 'bg-muted'
                  }`}>
                    <IconComponent className={`w-6 h-6 ${
                      packet.highlighted 
                        ? 'text-[#464646]' 
                        : 'text-muted-foreground'
                    }`} />
                  </div>
                  
                  <div>
                    <h4 className="font-semibold">{packet.name}</h4>
                    <div className="text-2xl font-bold mt-1">{packet.price}</div>
                  </div>
                  
                  <p className="text-sm font-medium text-center">
                    {packet.description}
                  </p>
                  
                  <p className="text-xs text-muted-foreground text-center leading-relaxed">
                    {packet.subtitle}
                  </p>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <ul className="space-y-2">
                  {packet.features.map((feature, index) => (
                    <li key={index} className="flex items-start space-x-2 text-sm">
                      <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        packet.highlighted 
                          ? 'text-[#fff38D]' 
                          : 'text-green-500'
                      }`} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <Button 
                  size="sm" 
                  className={`w-full ${packet.ctaClass}`}
                >
                  {packet.buttonText}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}