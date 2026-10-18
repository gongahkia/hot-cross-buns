import { InspectorProvider, InspectorShell } from "./components/Inspector";
import { CoreDataProvider } from "./features/core/coreViewModelSource";
import { AppShell } from "./features/shell/AppShell";

export default function App(): JSX.Element {
  return (
    <CoreDataProvider>
      <InspectorProvider>
        <AppShell />
        <InspectorShell />
      </InspectorProvider>
    </CoreDataProvider>
  );
}
