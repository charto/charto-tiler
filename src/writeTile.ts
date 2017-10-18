// This file is part of charto-tiler, copyright (c) 2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import { GeoTile } from 'geotree';
import * as cgeo from 'cgeo';
import 'cgeo-cpak';

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
