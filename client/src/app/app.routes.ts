import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'projects',
  },
  {
    path: 'projects',
    title: 'پروژه‌ها · دستیار مدیر محصول',
    loadComponent: () =>
      import('./features/projects/project-list').then((m) => m.ProjectListComponent),
  },
  {
    path: 'reports',
    title: 'گزارش‌ها · دستیار مدیر محصول',
    loadComponent: () =>
      import('./features/reports/report-page').then((m) => m.ReportPageComponent),
  },
  {
    path: 'teams',
    title: 'تیم‌ها · دستیار مدیر محصول',
    loadComponent: () => import('./features/teams/team-list').then((m) => m.TeamListComponent),
  },
  {
    path: 'people',
    title: 'افراد · دستیار مدیر محصول',
    loadComponent: () => import('./features/users/user-list').then((m) => m.UserListComponent),
  },
  {
    // `withComponentInputBinding()` feeds :projectId straight into the page's input().
    path: 'projects/:projectId',
    title: 'نمودار گانت · دستیار مدیر محصول',
    loadComponent: () => import('./features/gantt/gantt-page').then((m) => m.GanttPageComponent),
  },
  {
    path: '**',
    redirectTo: 'projects',
  },
];
