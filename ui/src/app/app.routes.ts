import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Home · anvil', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage) },
  {
    path: 'inbox',
    title: 'Inbox · anvil',
    data: { area: 'inbox' },
    loadComponent: () => import('./pages/area/area').then((m) => m.AreaPage),
  },
  {
    path: 'general',
    title: 'General · anvil',
    data: { area: 'general' },
    loadComponent: () => import('./pages/area/area').then((m) => m.AreaPage),
  },
  {
    path: 'projects/:id',
    title: 'Project · anvil',
    loadComponent: () => import('./pages/project/project').then((m) => m.ProjectPage),
  },
  { path: '**', redirectTo: '' },
];
