// This file is part of charto-tiler, copyright (c) 2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as Promise from 'bluebird';
import * as pgsql from 'pg';
import { TaskQueue } from 'cwait';
import { GeoTree, GeoTile } from 'geotree';
import * as cpak from 'cpak';
import * as cgeo from 'cgeo';
import 'cgeo-wkb';
import 'cgeo-cpak';

import { parseFeature, summarizeTile, writeTile } from '..';

const queue = new TaskQueue(Promise, 4);
const tree = new GeoTree(0, 0, 1, 1);

const pgPool = new pgsql.Pool();

const sqlCount = [
	'SELECT COUNT(*) AS count',
	'FROM feature',
	'WHERE geom && ST_MakeEnvelope($1, $2, $3, $4)'
].join(' ');

const sqlGet = [
	'SELECT geom',
	'FROM feature',
	'WHERE geom && ST_MakeEnvelope($1, $2, $3, $4)'
].join(' ');

function processTile(pg: pgsql.Client, result: any, tile: GeoTile): Promise<pgsql.QueryResult | void> | void {
	const count = result.rows[0].count;

	if(count >= 4096) {
		tile.split();
	} else {
		const ready = Promise.try(() => pg.query(
			sqlGet,
			[ tile.w, tile.s, tile.e, tile.n ]
		)).then((result: any) => {
			let geom: cgeo.Geometry;

			for(let row of result.rows) {
				if(row.geom) {
					geom = cgeo.Geometry.fromWKB(row.geom, { flipXY: true });
					parseFeature(tile, geom);
				}
			}
		});

		return(ready);
	}
}

Promise.try(
	() => pgPool.connect()
).then((pg: pgsql.Client) =>
	tree.iterate(queue.wrap((tile: GeoTile) =>
		tile.pointCount >= 4096 ? tile.split() :
		tile.pointCount ? true : Promise.try(() => pg.query(
			sqlCount,
			[ tile.w, tile.s, tile.e, tile.n ]
		)).then(
			(result: any) => processTile(pg, result, tile)
		).then(
			() => { tile.pointCount >= 4096 && tile.split(); }
		)
	), (tile: GeoTile) => {
		if(!tile.pointCount) {
			summarizeTile(tile);
		}
		writeTile(tile);
	})!.then(
		() => {
			const writer = new cpak.Writer();

			for(let flags of tree.exportStructure()) writer.small(flags);

			fs.writeFileSync('tiles.txt', writer.data, { encoding: 'utf-8' });

			return(pg.release());
		}
	)
).then(
	() => pgPool.end()
);
