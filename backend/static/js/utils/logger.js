/**
 * Logger Utility
 * 
 * Provides configurable logging levels to control console output.
 * In production, set DEBUG_MODE = false to disable verbose logging.
 */

const DEBUG_MODE = false;

export const logger = {
    debug: (...args) => {
        if (DEBUG_MODE) {
            console.log(...args);
        }
    },
    
    info: (...args) => {
        if (DEBUG_MODE) {
            console.info(...args);
        }
    },
    
    warn: (...args) => console.warn(...args),
    
    error: (...args) => console.error(...args),
    
    group: (label) => {
        if (DEBUG_MODE) {
            console.group(label);
        }
    },
    
    groupEnd: () => {
        if (DEBUG_MODE) {
            console.groupEnd();
        }
    }
};
