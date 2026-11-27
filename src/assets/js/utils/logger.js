/** Antepone `[nombre]:` en color a lo que se escriba en la consola de desarrollo, sin perder ningun argumento. */
export default function prefixConsole(name, color) {
    for (const level of ['log', 'info', 'warn', 'debug', 'error']) {
        const original = console[level];
        console[level] = (...values) => original.call(console, `%c[${name}]:`, `color: ${color};`, ...values);
    }
}
