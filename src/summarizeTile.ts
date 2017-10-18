// This file is part of charto-tiler, copyright (c) 2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import { GeoTile } from 'geotree';
import * as cgeo from 'cgeo';

export function summarizeTile(tile: GeoTile) {
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
