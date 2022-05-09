# osm.pbf file format parser for node.js and browser

Usage:

```html
<input id="file" type="file" />
```

```ts
import { parse, NODE, WAY, RELATION } from 'osm-pbf';

const stats = {
    node: 0,
    way: 0,
    relation: 0,
}

const osmType = {
    NODE: 'node',
    WAY: 'way',
    RELATION: 'relation'
}

async function onFileChange () {
    if (!(input instanceof HTMLInputElement)) {
        return;
    }
    for (const file of input.files) {
        for await(const chunk of parse(file.stream())) {
            for (const item of chunk) {
                const type = osmType[item.type];
                stats[type] += 1;
            }
        }
    }
    console.log('done!', stats);
}

const input = document.querySelector('#file');
if (input) {
    input.addEventListener('change', onFileChange)
}
```