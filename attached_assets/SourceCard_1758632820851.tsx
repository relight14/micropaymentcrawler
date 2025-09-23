import { Card, CardContent, CardHeader } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ExternalLink, Download, Lock, Star } from "lucide-react";

interface SourceCardProps {
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

export function SourceCard({
  title,
  url,
  summary,
  sourceType,
  licenseType,
  price,
  rating,
  publishDate,
  author
}: SourceCardProps) {
  const getLicenseColor = () => {
    switch (licenseType) {
      case 'free': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'paid': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'premium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    }
  };

  return (
    <Card className="hover:shadow-lg transition-shadow duration-200 border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-semibold line-clamp-2">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {author} • {publishDate}
            </p>
          </div>
          <div className="flex items-center space-x-2 ml-4">
            <Badge variant="secondary" className="text-xs">
              {sourceType}
            </Badge>
            <Badge className={`text-xs ${getLicenseColor()}`}>
              {licenseType}
              {price && ` $${price}`}
            </Badge>
          </div>
        </div>
        
        {rating && (
          <div className="flex items-center space-x-1 mt-2">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={`w-3 h-3 ${
                  i < rating ? 'text-yellow-400 fill-current' : 'text-gray-300'
                }`}
              />
            ))}
            <span className="text-xs text-muted-foreground ml-1">({rating}/5)</span>
          </div>
        )}
      </CardHeader>
      
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
          {summary}
        </p>
        
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" className="flex items-center space-x-2">
            <ExternalLink className="w-3 h-3" />
            <span>View Source</span>
          </Button>
          
          <div className="flex items-center space-x-2">
            {licenseType === 'free' ? (
              <Button size="sm" className="bg-green-600 hover:bg-green-700">
                <Download className="w-3 h-3 mr-2" />
                Download
              </Button>
            ) : (
              <Button size="sm" className="bg-[#fff38D] hover:bg-[#fff38D]/90 text-[#464646]">
                <Lock className="w-3 h-3 mr-2" />
                Unlock {price && `${price}`}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}