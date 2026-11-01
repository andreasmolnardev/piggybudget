import { pb } from './api/pocketbase';
import { createAuthenticationStore, createPocketBaseAuthAdapter } from './lib/slopstack';

export const authenticationStore = createAuthenticationStore(createPocketBaseAuthAdapter(pb));
