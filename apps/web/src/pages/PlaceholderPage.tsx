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
          title="Coming in a later step"
          description={`${title} is planned for ${step}. Nothing is missing — it will appear here when it is built.`}
        />
      </Panel>
    </div>
  );
}
