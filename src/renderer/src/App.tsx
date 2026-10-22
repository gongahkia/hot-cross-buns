import { InspectorProvider } from "./components/Inspector";
import { CoreDataProvider } from "./features/core/coreViewModelSource";
import { AppShell } from "./features/shell/AppShell";
import { TextPromptProvider } from "./components/TextPrompt";

export default function App(): JSX.Element {
  return (
    <CoreDataProvider>
      <InspectorProvider>
        <TextPromptProvider>
          <AppShell />
        </TextPromptProvider>
      </InspectorProvider>
    </CoreDataProvider>
  );
}
