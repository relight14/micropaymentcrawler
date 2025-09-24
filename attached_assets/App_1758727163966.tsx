import { OutlineReport } from "./components/OutlineReport";
import { NarrativeReport } from "./components/NarrativeReport";

export default function App() {
  return (
    <div className="h-screen bg-gray-100 p-4">
      <div className="h-full max-w-7xl mx-auto">
        <div className="grid grid-cols-2 gap-6 h-full">
          <div className="min-h-0">
            <div className="mb-3">
              <h2 className="font-sans font-medium text-lg text-center">Outline Mode</h2>
              <p className="text-sm text-muted-foreground text-center">Clean, academic style</p>
            </div>
            <OutlineReport />
          </div>
          <div className="min-h-0">
            <div className="mb-3">
              <h2 className="font-sans font-medium text-lg text-center">Narrative Mode</h2>
              <p className="text-sm text-muted-foreground text-center">Briefing / analyst style</p>
            </div>
            <NarrativeReport />
          </div>
        </div>
      </div>
    </div>
  );
}