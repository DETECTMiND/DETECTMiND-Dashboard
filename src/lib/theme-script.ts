// Shared by the server layout (inline script) and the client theme hook, so no 'use client' here.

export const THEME_STORAGE_KEY = 'theme'

/** Runs in <head> before paint so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem('${THEME_STORAGE_KEY}');var d=c==='dark'||(c!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`
