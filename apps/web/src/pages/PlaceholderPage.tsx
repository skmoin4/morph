import { PageHeader } from '../components/layout/PageHeader';
import { Panel } from '../components/ui/Panel';
import { EmptyState } from '../components/ui/EmptyState';

/**
 * Stands in for a module that has not been built yet, so the sidebar never
 * leads to a dead route during the build.
 */
export function PlaceholderPage({
  eyebrow,
  title,
  subtitle,
  step,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  step: string;
}) {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <Panel>
        <EmptyState
          title={`${title} arrives in ${step}`}
          description="The app shell is in review first — modules follow once the UI kit is signed off."
        />
      </Panel>
    </div>
  );
}
