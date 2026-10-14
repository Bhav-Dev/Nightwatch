/**
 * The current session token for the API client, held outside React so the client (a
 * long-lived object) always sends the latest token without re-creating itself.
 */
let token: string | null = null;

export const getToken = () => token;
export const setToken = (t: string | null) => {
  token = t;
};
