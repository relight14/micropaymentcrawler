import { FileText, AlignLeft, CheckCircle, BookOpen } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { ReportHeader } from "./ReportHeader";
import { SourceBadge } from "./SourceBadge";

export function NarrativeReport() {
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
          title="Digital Banking Transformation Analysis"
          date="December 15, 2024"
          query="comprehensive analysis of digital banking evolution and market impact"
        />
        
        <CardContent className="p-6 space-y-6 overflow-y-auto">
          {/* Executive Summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-sans font-medium">Executive Summary</h2>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg space-y-4">
              <p className="font-serif leading-relaxed">
                The financial services industry is undergoing a fundamental transformation as traditional banking institutions 
                rapidly adopt digital technologies to meet evolving customer expectations and competitive pressures<sup className="text-xs text-gray-400">[1]</sup>.
              </p>
              <p className="font-serif leading-relaxed">
                This comprehensive analysis reveals that banks investing heavily in digital infrastructure and customer 
                experience are achieving significant operational efficiencies and market share gains<sup className="text-xs text-gray-400">[2]</sup> compared to their 
                more traditional counterparts.
              </p>
              <p className="font-serif leading-relaxed">
                The research indicates that successful digital transformation requires not only technological upgrades 
                but also cultural shifts, regulatory compliance adaptations, and strategic partnerships with fintech companies<sup className="text-xs text-gray-400">[3]</sup>.
              </p>
            </div>
          </div>

          {/* Main Body */}
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <AlignLeft className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-sans font-medium">Main Body</h2>
            </div>
            
            {/* Subsection 1 */}
            <div className="space-y-3">
              <h3 className="font-sans font-medium text-primary">Market Drivers and Competitive Landscape</h3>
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <p className="font-serif leading-relaxed">
                  The digital banking revolution has been accelerated by multiple converging factors, including changing consumer 
                  behavior patterns, regulatory initiatives promoting open banking<sup className="text-xs text-gray-400">[1]</sup>, and the emergence of agile fintech competitors 
                  that have raised customer expectations for seamless digital experiences<sup className="text-xs text-gray-400">[2]</sup>.
                </p>
                <p className="font-serif leading-relaxed">
                  Traditional banks face the dual challenge of maintaining their existing customer base while simultaneously 
                  investing in new technologies and digital capabilities to remain competitive in an increasingly crowded marketplace<sup className="text-xs text-gray-400">[4]</sup>.
                </p>
              </div>
            </div>

            {/* Subsection 2 */}
            <div className="space-y-3">
              <h3 className="font-sans font-medium text-primary">Technology Infrastructure Evolution</h3>
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <p className="font-serif leading-relaxed">
                  Leading banks are investing heavily in cloud-native architectures, API-first development approaches<sup className="text-xs text-gray-400">[3]</sup>, and 
                  artificial intelligence capabilities to create more flexible, scalable, and intelligent banking platforms 
                  that can adapt quickly to changing market conditions<sup className="text-xs text-gray-400">[2]</sup>.
                </p>
              </div>
            </div>

            {/* Subsection 3 */}
            <div className="space-y-3">
              <h3 className="font-sans font-medium text-primary">Customer Experience Transformation</h3>
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <p className="font-serif leading-relaxed">
                  The shift toward mobile-first banking experiences has fundamentally altered how customers interact with 
                  financial institutions<sup className="text-xs text-gray-400">[1]</sup>, with successful banks focusing on intuitive user interfaces, personalized 
                  recommendations, and seamless omnichannel experiences<sup className="text-xs text-gray-400">[4]</sup>.
                </p>
                <p className="font-serif leading-relaxed">
                  Data analytics and machine learning capabilities enable banks to offer increasingly sophisticated 
                  personalization while maintaining strict privacy and security standards required by regulatory frameworks<sup className="text-xs text-gray-400">[3]</sup>.
                </p>
              </div>
            </div>

            {/* Subsection 4 */}
            <div className="space-y-3">
              <h3 className="font-sans font-medium text-primary">Regulatory Compliance and Risk Management</h3>
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <p className="font-serif leading-relaxed">
                  Digital transformation initiatives must navigate complex regulatory environments while implementing 
                  robust cybersecurity measures and maintaining compliance with evolving data protection requirements 
                  across multiple jurisdictions<sup className="text-xs text-gray-400">[3]</sup>.
                </p>
              </div>
            </div>
          </div>

          {/* Conclusion */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-sans font-medium">Conclusion</h2>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="font-serif leading-relaxed">
                The evidence strongly suggests that digital transformation is no longer optional for traditional banking 
                institutions but rather a critical imperative for long-term survival and growth<sup className="text-xs text-gray-400">[2]</sup>. Banks that successfully 
                balance technological innovation with regulatory compliance and customer trust will be best positioned 
                to thrive in the evolving financial services landscape<sup className="text-xs text-gray-400">[4]</sup>.
              </p>
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