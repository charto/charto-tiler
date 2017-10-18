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
	const shift = Math.max(0, 12 - tile.path.length);
	const factor = Math.max(tile.n - tile.s, tile.e - tile.w) / 512;

	const points = new cgeo.MultiPoint();

	for(let geom of tile.pointList) {
		points.addChild(geom);
	}

	const json = {
		south: tile.s,
		west: tile.w,
		north: tile.n,
		east: tile.e,
		pointCount: points.childList.length,
		pointData: points.toCpak(),
		weightData: tile.pointWeightList
	};

	fs.writeFileSync('tiles/' + tile.path + '.txt', JSON.stringify(json), { encoding: 'utf-8' });

}

function parseFeature(tile: GeoTile, geom: cgeo.Geometry) {
	if(geom instanceof cgeo.GeometryCollection) {
		for(let child of geom.childList) parseFeature(tile, child);
	}

	if(geom.kind == cgeo.GeometryKind.point) {
		const pt = geom as cgeo.Point;

		if(pt.x >= tile.s && pt.x < tile.n && pt.y >= tile.w && pt.y < tile.e) {
			tile.addPoint(geom as cgeo.Point);
		}
	}
}

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

function summarizeTile(tile: GeoTile) {
	let item: { x: number, y: number, count: number };
	const grid: { x: number, y: number, count: number }[] = new Array(64 * 64);
	const scaleX = 64 / (tile.n - tile.s);
	const scaleY = 64 / (tile.e - tile.w);
	let pos: number;
	let x: number;
	let y: number;

	for(let child of tile.childList || []) {
		if(!child) continue;

		const weightList = child.pointWeightList || [];
		let weight: number;
		let num = 0;

		for(let pt of child.pointList) {
			x = ~~((pt.x - tile.s) * scaleX);
			y = ~~((pt.y - tile.w) * scaleY);
			pos = y * 64 + x;
			item = grid[pos] || (grid[pos] = { x: 0, y: 0, count: 0 });
			weight = weightList[num++] || 1;

			item.x += pt.x * weight;
			item.y += pt.y * weight;
			item.count += weight;
		}
	}

	tile.pointWeightList = [];
	pos = 64 * 64;

	while(pos--) {
		item = grid[pos];

		if(item) {
			tile.pointList.push(new cgeo.Point(item.x / item.count, item.y / item.count));
			tile.pointWeightList.push(item.count);
			++tile.pointCount;
		}
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
