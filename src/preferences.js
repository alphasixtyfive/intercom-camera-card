export function readPreference(key) {
    if (!key) return null;
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.debug(error);
        return null;
    }
}

export function writePreference(key, value) {
    if (!key) return;
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.debug(error);
    }
}
