import { Blob, BlobHeader } from './fileformat';
import { HeaderBlock, PrimitiveBlock } from './osmformat';
import Pbf = require('pbf');
import { unzlibSync } from 'fflate';

export const NODE = 0;
export const WAY = 1;
export const RELATION = 2;

interface OsmBlock {
    type: 'OSMHeader' | 'OSMData';
    data: Uint8Array;
}

export async function* parse(input: ReadableStream<Uint8Array>) {
    yield* parseOsmBlock(parseChunk(bufferGenerator(input)));
}

async function* bufferGenerator(input: ReadableStream<Uint8Array>): AsyncGenerator<ArrayBuffer> {
    const reader = input.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            return;
        }
        yield value.buffer;
    }
}

const LENGTH = 0;
const HEADER = 1;
const BLOB = 2;

async function* parseChunk(
    chunks: AsyncGenerator<ArrayBuffer>,
    debug = false,
): AsyncGenerator<OsmBlock> {
    let pbf: Pbf | null = null;
    let state: number = LENGTH;
    let waitSize: number = 4;
    let header: any;

    for await (const chunk of chunks) {
        if (pbf) {
            const oldPbf = pbf;
            pbf = new Pbf(concatArrayBuffers(pbf.buf.slice(pbf.pos), chunk));
            oldPbf.destroy();
        } else {
            pbf = new Pbf(chunk);
        }

        while (pbf.pos < pbf.length) {
            if (state === LENGTH) {
                if (debug) {
                    console.log('=length', pbf.pos, pbf.length, waitSize);
                }
                if (pbf.pos + waitSize > pbf.length) {
                    break;
                }
                waitSize = readLength(pbf.buf, pbf.pos);
                pbf.pos += 4;
                state = HEADER;
            } else if (state === HEADER) {
                if (debug) {
                    console.log('=header', pbf.pos, pbf.length, waitSize);
                }
                if (pbf.pos + waitSize > pbf.length) {
                    break;
                }
                header = BlobHeader.read(pbf, pbf.pos + waitSize);
                waitSize = header.datasize;
                state = BLOB;
            } else if (state === BLOB) {
                if (debug) {
                    console.log('=blob', pbf.pos, pbf.length, waitSize);
                }
                if (pbf.pos + waitSize > pbf.length) {
                    break;
                }
                const blob = Blob.read(pbf, pbf.pos + waitSize);
                yield {
                    type: header.type,
                    data: unzlibSync(blob.zlib_data),
                };
                state = LENGTH;
                waitSize = 4;
            }
        }
    }
}

async function* parseOsmBlock(blocks: AsyncGenerator<OsmBlock>) {
    for await (const raw of blocks) {
        const pbf = new Pbf(raw.data);
        if (raw.type === 'OSMHeader') {
            // TODO Emit header info
            const block = HeaderBlock.read(pbf);
            yield [];
        } else if (raw.type === 'OSMData') {
            const block = PrimitiveBlock.read(pbf);
            yield decodeBlock(block);
        }
        pbf.destroy();
    }
}

function decodeBlock(block: any) {
    const strings = block.stringtable.s;
    const result: any[] = [];

    let { lat_offset, lon_offset, granularity } = block;
    if (!granularity) {
        granularity = 100;
    }

    const getLat = (lat) => 0.000000001 * (lat_offset + granularity * lat);
    const getLon = (lon) => 0.000000001 * (lon_offset + granularity * lon);

    for (const group of block.primitivegroup) {
        for (const node of group.nodes) {
            console.log(node);
            throw new Error('Unpacking sparse node not implemented');
        }
        for (const way of group.ways) {
            const tags = {};
            for (let i = 0; i < way.keys.length; i++) {
                tags[strings[way.keys[i]]] = strings[way.vals[i]];
            }
            const refs: number[] = [];
            let r = 0;
            for (let i = 0; i < way.refs.length; i++) {
                r += way.refs[i];
                refs.push(r);
            }
            result.push({
                type: WAY,
                id: way.id,
                tags,
                refs,
            });
        }
        for (const rel of group.relations) {
            const tags = {};
            for (let i = 0; i < rel.keys.length; i++) {
                tags[strings[rel.keys[i]]] = strings[rel.vals[i]];
            }
            const members: any[] = [];
            for (let i = 0; i < rel.memids.length; i++) {
                members.push({
                    id: rel.memids[i],
                    role: rel.roles_sid[i],
                    type: rel.types[i],
                });
            }
            result.push({
                type: RELATION,
                id: rel.id,
                tags,
                members,
            });
        }
        if (group.dense) {
            const dense = group.dense;
            let tpos = 0;
            let lat = 0;
            let lon = 0;
            for (let i = 0; i < dense.id.length; i++) {
                const tags = {};
                const kv = dense.keys_vals;
                while (kv[tpos] !== 0) {
                    tags[strings[kv[tpos]]] = strings[kv[tpos + 1]];
                    tpos += 2;
                }
                tpos += 1;
                lat += dense.lat[i];
                lon += dense.lon[i];
                result.push({
                    type: NODE,
                    lat: getLat(lat),
                    lon: getLon(lon),
                    tags,
                });
            }
        }
    }
    return result;
}

function concatArrayBuffers(buffer1, buffer2) {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}

function readLength(arr: Uint8Array, pos: number) {
    return (arr[pos] << 24) | (arr[pos + 1] << 16) | (arr[pos + 2] << 8) | arr[pos + 3];
}
