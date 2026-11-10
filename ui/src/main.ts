import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { captureToken, sessionStore } from './app/core/token';

// Before the router reads the URL, so the token never shows up in it again.
captureToken(window, sessionStore());

bootstrapApplication(App, appConfig).catch((error: unknown) => console.error(error));
