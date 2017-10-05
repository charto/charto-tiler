// This file is part of charto-tiler, copyright (c) 2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as Promise from 'bluebird';
import * as pgsql from 'pg';
import { TaskQueue } from 'cwait';
import { GeoTree, GeoTile } from 'geotree';
import { Geometry, GeometryCollection, GeometryKind, Point } from 'geobabel';

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

export function writeTile(tile: GeoTile) {
	for(let geom of tile.pointList) {
		console.log(geom.pos[0] + ' ' + geom.pos[1]);
	}
}

function parseFeature(tile: GeoTile, geom: Geometry) {
	if(geom instanceof GeometryCollection) {
		for(let child of geom.childList) parseFeature(tile, child);
	}

	if(geom.kind == GeometryKind.point) {
		tile.addPoint(geom as Point);
	}
}

function processTile(pg: pgsql.Client, result: any, tile: GeoTile): Promise<pgsql.QueryResult | void> | void {
	const count = result.rows[0].count;

	console.log(count);

	if(count >= 4096) {
		tile.split();
	} else {
		const ready = Promise.try(() => pg.query(
			sqlGet,
			[ tile.w, tile.s, tile.e, tile.n ]
		)).then((result: any) => {
			let geom: Geometry;

			for(let row of result.rows) {
				if(row.geom) {
					geom = Geometry.fromWKB(row.geom);
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
		Promise.try(() => pg.query(
			sqlCount,
			[ tile.w, tile.s, tile.e, tile.n ]
		)).then(
			(result: any) => processTile(pg, result, tile)
		).then(
			() => writeTile(tile)
		)
	))!.then(
		() => pg.release()
	)
).then(
	() => pgPool.end()
);
