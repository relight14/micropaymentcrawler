import { FileText, List, BookOpen } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { ReportHeader } from "./ReportHeader";
import { SourceBadge } from "./SourceBadge";

export function OutlineReport() {
  const sources = [
    { publisher: "Harvard Business Review", title: "Digital Transformation in Banking", license: "RSL" as const, cost: "$0.15" },
    { publisher: "McKinsey & Company", title: "The Future of Financial Services", license: "Tollbit" as const, cost: "$0.22" },
    { publisher: "Deloitte Insights", title: "Banking Industry Outlook 2024", license: "Cloudflare" as const, cost: "$0.18" },
    { publisher: "PwC Research", title: "Fintech Trends and Predictions", license: "RSL" as const, cost: "$0.12" }
  ];

  return (
    <div className="h-full bg-gray-50 overflow-hidden">
      <Card className="h-full shadow-sm">
        <ReportHeader 
          title="Digital Banking Transformation Report"
          date="December 15, 2024"
          query="impact of digital transformation on traditional banking"
        />
        
        <CardContent className="p-6 space-y-6 overflow-y-auto">
          {/* Executive Summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-sans font-medium">Executive Summary</h2>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="font-serif text-muted-foreground leading-relaxed">
                The digital transformation of traditional banking institutions has accelerated significantly over the past decade<sup className="text-xs text-gray-400">[1]</sup>, 
                driven by changing consumer expectations, regulatory pressures, and competitive threats from fintech startups<sup className="text-xs text-gray-400">[2]</sup>. 
                This comprehensive analysis examines the key drivers, challenges, and outcomes of digital banking initiatives.
              </p>
            </div>
          </div>

          {/* Research Outline */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <List className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-sans font-medium">Research Outline</h2>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <ul className="font-serif space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <div>
                    <span>Digital Banking Market Overview</span>
                    <ul className="ml-4 mt-1 space-y-1 text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="mt-1">◦</span>
                        <span>Market size and growth projections<sup className="text-xs text-gray-400">[1]</sup></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1">◦</span>
                        <span>Key market segments and demographics<sup className="text-xs text-gray-400">[2]</sup></span>
                      </li>
                    </ul>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <div>
                    <span>Technology Infrastructure and Innovation</span>
                    <ul className="ml-4 mt-1 space-y-1 text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="mt-1">◦</span>
                        <span>Cloud computing adoption</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1">◦</span>
                        <span>API integration and open banking</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1">◦</span>
                        <span>Artificial intelligence and automation</span>
                      </li>
                    </ul>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <div>
                    <span>Customer Experience Transformation</span>
                    <ul className="ml-4 mt-1 space-y-1 text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="mt-1">◦</span>
                        <span>Mobile-first banking strategies</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1">◦</span>
                        <span>Personalization and data analytics</span>
                      </li>
                    </ul>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          {/* Sources */}
          <div className="space-y-4 border-t border-border pt-6">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-sans font-medium">Sources</h2>
            </div>
            <div className="space-y-4">
              {sources.map((source, index) => (
                <div key={index} className="flex gap-4 pb-3 border-b border-border last:border-b-0">
                  <div className="font-sans text-sm font-medium text-primary min-w-[20px]">
                    {index + 1}.
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="font-sans text-sm text-muted-foreground">{source.publisher}</div>
                    <div className="font-serif">
                      <a href="#" className="text-primary hover:underline">{source.title}</a>
                    </div>
                    <div className="flex items-center gap-3">
                      <SourceBadge license={source.license} />
                      <div className="font-sans text-sm font-medium text-muted-foreground">{source.cost}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}