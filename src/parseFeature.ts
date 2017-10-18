// This file is part of charto-tiler, copyright (c) 2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import { GeoTile } from 'geotree';
import * as cgeo from 'cgeo';

export function parseFeature(tile: GeoTile, geom: cgeo.Geometry) {
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
