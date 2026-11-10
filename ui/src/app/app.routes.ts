import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Home · anvil', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage) },
  { path: 'inbox', title: 'Inbox · anvil', loadComponent: () => import('./pages/inbox/inbox').then((m) => m.InboxPage) },
  { path: 'general', title: 'General · anvil', loadComponent: () => import('./pages/general/general').then((m) => m.GeneralPage) },
  {
    path: 'projects/:id/release',
    title: 'Publish a release · anvil',
    loadComponent: () => import('./pages/release/release').then((m) => m.ReleasePage),
  },
  {
    path: 'projects/:id',
    title: 'Project · anvil',
    loadComponent: () => import('./pages/project/project').then((m) => m.ProjectPage),
  },
  { path: '**', redirectTo: '' },
];
