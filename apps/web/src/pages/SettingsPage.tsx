import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import { Pill } from '../components/ui/Pill';
import { CompanyTab } from '../features/settings/CompanyTab';
import { OfficesTab } from '../features/settings/OfficesTab';
import {
  DepartmentsTab,
  DesignationsTab,
  ExpenseCategoriesTab,
  ProjectTypesTab,
} from '../features/settings/OrgTabs';
import { AttendancePoliciesTab, HolidaysTab, LeaveTypesTab } from '../features/settings/PolicyTabs';
import { useAuth } from '../providers/AuthProvider';

const TABS = [
  { key: 'company', label: 'Company' },
  { key: 'offices', label: 'Offices' },
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Designations' },
  { key: 'project-types', label: 'Project types' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'attendance', label: 'Attendance policy' },
  { key: 'leave-types', label: 'Leave types' },
  { key: 'expense-categories', label: 'Expense categories' },
];

export function SettingsPage() {
  const { can } = useAuth();
  // The tab lives in the URL so a particular settings screen can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'company';
  const canEdit = can('settings.edit');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        subtitle="Company, offices and the policies the rest of the system runs on."
        actions={
          !canEdit && (
            <Pill tone="gray" dot={false}>
              Read only
            </Pill>
          )
        }
      />

      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(key) => setSearchParams(key === 'company' ? {} : { tab: key })}
      />

      <TabPanel>
        {tab === 'company' && <CompanyTab canEdit={canEdit} />}
        {tab === 'offices' && <OfficesTab canEdit={canEdit} />}
        {tab === 'departments' && <DepartmentsTab canEdit={canEdit} />}
        {tab === 'designations' && <DesignationsTab canEdit={canEdit} />}
        {tab === 'project-types' && <ProjectTypesTab canEdit={canEdit} />}
        {tab === 'holidays' && <HolidaysTab canEdit={canEdit} />}
        {tab === 'attendance' && <AttendancePoliciesTab canEdit={canEdit} />}
        {tab === 'leave-types' && <LeaveTypesTab canEdit={canEdit} />}
        {tab === 'expense-categories' && <ExpenseCategoriesTab canEdit={canEdit} />}
      </TabPanel>
    </div>
  );
}
