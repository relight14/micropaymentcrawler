import { useState } from "react";
import { SearchInput } from "./SearchInput";
import { SourceCard } from "./SourceCard";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Filter, SortAsc, Sparkles } from "lucide-react";

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

export function ResearchInterface() {
  const [sources, setSources] = useState<Source[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("relevance");
  const [filterType, setFilterType] = useState("all");

  const handleSearch = async (searchQuery: string) => {
    setQuery(searchQuery);
    setIsSearching(true);
    
    // Simulate API call
    setTimeout(() => {
      const mockSources: Source[] = [
        {
          id: '1',
          title: `Comprehensive Analysis of ${searchQuery}: Current Trends and Future Implications`,
          url: 'https://example.com/research1',
          summary: `This comprehensive study examines the current state of ${searchQuery} research, analyzing recent developments and their potential impact on future applications. The paper includes detailed statistical analysis and expert interviews.`,
          sourceType: 'Academic Paper',
          licenseType: 'free',
          rating: 4.8,
          publishDate: '2024-01-15',
          author: 'Dr. Sarah Chen et al.'
        },
        {
          id: '2',
          title: `${searchQuery} Market Report 2024: Industry Insights and Strategic Recommendations`,
          url: 'https://example.com/report2',
          summary: `Professional market analysis providing strategic insights into ${searchQuery} industry trends, market dynamics, and growth opportunities. Includes exclusive data and expert forecasts.`,
          sourceType: 'Industry Report',
          licenseType: 'paid',
          price: 299,
          rating: 4.6,
          publishDate: '2024-02-28',
          author: 'Strategic Analytics Corp'
        },
        {
          id: '3',
          title: `Advanced ${searchQuery} Techniques: A Practitioner's Guide`,
          url: 'https://example.com/guide3',
          summary: `Practical guide covering advanced techniques and best practices in ${searchQuery}. Written by industry experts with real-world case studies and implementation strategies.`,
          sourceType: 'Professional Guide',
          licenseType: 'premium',
          price: 149,
          rating: 4.9,
          publishDate: '2024-03-10',
          author: 'Expert Consulting Group'
        },
        {
          id: '4',
          title: `Open Source ${searchQuery} Framework Documentation`,
          url: 'https://example.com/docs4',
          summary: `Comprehensive documentation and technical specifications for the leading open-source framework in ${searchQuery}. Includes API references, tutorials, and community contributions.`,
          sourceType: 'Documentation',
          licenseType: 'free',
          rating: 4.4,
          publishDate: '2024-03-20',
          author: 'Open Source Community'
        },
        {
          id: '5',
          title: `${searchQuery} Case Studies: Lessons from Leading Organizations`,
          url: 'https://example.com/cases5',
          summary: `Collection of detailed case studies examining how top organizations have successfully implemented ${searchQuery} solutions. Includes interviews with key decision makers and ROI analysis.`,
          sourceType: 'Case Study',
          licenseType: 'paid',
          price: 199,
          rating: 4.7,
          publishDate: '2024-02-05',
          author: 'Business Research Institute'
        }
      ];
      
      setSources(mockSources);
      setIsSearching(false);
    }, 2000);
  };

  const getResultCount = () => sources.length;

  return (
    <div className="flex flex-col h-full">
      {/* Research Header */}
      <div className="p-4 border-b border-border">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">LedeWire Research Assistant</h2>
              <p className="text-sm text-muted-foreground">Ethically Licensed Content</p>
            </div>
            <Badge variant="outline" className="flex items-center space-x-1">
              <Sparkles className="w-3 h-3" />
              <span>AI-Powered</span>
            </Badge>
          </div>
          
          <SearchInput
            onSubmit={handleSearch}
            placeholder="Search for research papers, reports, articles..."
            disabled={isSearching}
          />
        </div>
      </div>

      {/* Results Area */}
      <div className="flex-1 overflow-hidden">
        {query && (
          <div className="p-4 border-b border-border bg-muted/30">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <span className="text-sm">
                  {isSearching ? 'Searching...' : `${getResultCount()} results for "${query}"`}
                </span>
                {!isSearching && (
                  <div className="flex items-center space-x-2">
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="w-40 h-8">
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="relevance">Relevance</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="rating">Rating</SelectItem>
                        <SelectItem value="price">Price</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Select value={filterType} onValueChange={setFilterType}>
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue placeholder="Filter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="free">Free Only</SelectItem>
                        <SelectItem value="paid">Paid Only</SelectItem>
                        <SelectItem value="academic">Academic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              
              <Button variant="outline" size="sm" className="flex items-center space-x-2">
                <Filter className="w-3 h-3" />
                <span>More Filters</span>
              </Button>
            </div>
          </div>
        )}

        <div className="p-4 h-full overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {isSearching ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="bg-muted rounded-lg h-40 mb-4" />
                  </div>
                ))}
              </div>
            ) : sources.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {sources.map((source) => (
                  <SourceCard key={source.id} {...source} />
                ))}
              </div>
            ) : query ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No results found for "{query}"</p>
                <p className="text-sm text-muted-foreground mt-2">Try adjusting your search terms or filters</p>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-[#fff38D] rounded-lg flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <Sparkles className="w-8 h-8 text-[#464646]" />
                </div>
                <h3 className="font-semibold mb-2 text-[#464646]">Start Your Research</h3>
                <p className="text-[#464646]/70 max-w-md mx-auto">
                  Search for academic papers, industry reports, case studies, and more. 
                  Access both free and premium sources with direct licensing options.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}