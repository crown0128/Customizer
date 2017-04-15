(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*

## IMPORTANT NOTE --- IMPORTANT 
The master for this file is located at:
https://github.com/joostn/openjscad/tree/gh-pages
That is the gh-pages branch of the joostn/openjscad project
If contributing from openjscad.org, please do NOT edit this local file but make pull requests against
above joostn/gh-pages branch.
## IMPORTANT NOTE --- IMPORTANT NOTE


## License

Copyright (c) 2014 bebbi (elghatta@gmail.com)
Copyright (c) 2013 Eduard Bespalov (edwbes@gmail.com)
Copyright (c) 2012 Joost Nieuwenhuijse (joost@newhouse.nl)
Copyright (c) 2011 Evan Wallace (http://evanw.github.com/csg.js/)
Copyright (c) 2012 Alexandre Girard (https://github.com/alx)

All code released under MIT license

## Overview

For an overview of the CSG process see the original csg.js code:
http://evanw.github.com/csg.js/

CSG operations through BSP trees suffer from one problem: heavy fragmentation
of polygons. If two CSG solids of n polygons are unified, the resulting solid may have
in the order of n*n polygons, because each polygon is split by the planes of all other
polygons. After a few operations the number of polygons explodes.

This version of CSG.js solves the problem in 3 ways:

1. Every polygon split is recorded in a tree (CSG.PolygonTreeNode). This is a separate
tree, not to be confused with the CSG tree. If a polygon is split into two parts but in
the end both fragments have not been discarded by the CSG operation, we can retrieve
the original unsplit polygon from the tree, instead of the two fragments.

This does not completely solve the issue though: if a polygon is split multiple times
the number of fragments depends on the order of subsequent splits, and we might still
end up with unncessary splits:
Suppose a polygon is first split into A and B, and then into A1, B1, A2, B2. Suppose B2 is
discarded. We will end up with 2 polygons: A and B1. Depending on the actual split boundaries
we could still have joined A and B1 into one polygon. Therefore a second approach is used as well:

2. After CSG operations all coplanar polygon fragments are joined by a retesselating
operation. See CSG.reTesselated(). Retesselation is done through a
linear sweep over the polygon surface. The sweep line passes over the y coordinates
of all vertices in the polygon. Polygons are split at each sweep line, and the fragments
are joined horizontally and vertically into larger polygons (making sure that we
will end up with convex polygons).
This still doesn't solve the problem completely: due to floating point imprecisions
we may end up with small gaps between polygons, and polygons may not be exactly coplanar
anymore, and as a result the retesselation algorithm may fail to join those polygons.
Therefore:

3. A canonicalization algorithm is implemented: it looks for vertices that have
approximately the same coordinates (with a certain tolerance, say 1e-5) and replaces
them with the same vertex. If polygons share a vertex they will actually point to the
same CSG.Vertex instance. The same is done for polygon planes. See CSG.canonicalized().


Performance improvements to the original CSG.js:

Replaced the flip() and invert() methods by flipped() and inverted() which don't
modify the source object. This allows to get rid of all clone() calls, so that
multiple polygons can refer to the same CSG.Plane instance etc.

The original union() used an extra invert(), clipTo(), invert() sequence just to remove the
coplanar front faces from b; this is now combined in a single b.clipTo(a, true) call.

Detection whether a polygon is in front or in back of a plane: for each polygon
we are caching the coordinates of the bounding sphere. If the bounding sphere is
in front or in back of the plane we don't have to check the individual vertices
anymore.


Other additions to the original CSG.js:

CSG.Vector class has been renamed into CSG.Vector3D

Classes for 3D lines, 2D vectors, 2D lines, and methods to find the intersection of
a line and a plane etc.

Transformations: CSG.transform(), CSG.translate(), CSG.rotate(), CSG.scale()

Expanding or contracting a solid: CSG.expand() and CSG.contract(). Creates nice
smooth corners.

The vertex normal has been removed since it complicates retesselation. It's not needed
for solid CAD anyway.

*/

    var _CSGDEBUG = false;

    function fnNumberSort(a, b) {
        return a - b;
    }

    // # class CSG
    // Holds a binary space partition tree representing a 3D solid. Two solids can
    // be combined using the `union()`, `subtract()`, and `intersect()` methods.
    var CSG = function() {
        this.polygons = [];
        this.properties = new CSG.Properties();
        this.isCanonicalized = true;
        this.isRetesselated = true;
    };

    CSG.defaultResolution2D = 32;
    CSG.defaultResolution3D = 12;

    // Construct a CSG solid from a list of `CSG.Polygon` instances.
    CSG.fromPolygons = function(polygons) {
        var csg = new CSG();
        csg.polygons = polygons;
        csg.isCanonicalized = false;
        csg.isRetesselated = false;
        return csg;
    };

    // Construct a CSG solid from generated slices.
    // Look at CSG.Polygon.prototype.solidFromSlices for details
    CSG.fromSlices = function(options) {
        return (new CSG.Polygon.createFromPoints([
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
            [0, 1, 0]
        ])).solidFromSlices(options);
    };

    // create from an untyped object with identical property names:
    CSG.fromObject = function(obj) {
        var polygons = obj.polygons.map(function(p) {
            return CSG.Polygon.fromObject(p);
        });
        var csg = CSG.fromPolygons(polygons);
        csg.isCanonicalized = obj.isCanonicalized;
        csg.isRetesselated  = obj.isRetesselated;
        return csg;
    };

    // Reconstruct a CSG from the output of toCompactBinary()
    CSG.fromCompactBinary = function(bin) {
        if (bin['class'] != "CSG") throw new Error("Not a CSG");
        var planes = [],
            planeData = bin.planeData,
            numplanes = planeData.length / 4,
            arrayindex = 0,
            x, y, z, w, normal, plane;
        for (var planeindex = 0; planeindex < numplanes; planeindex++) {
            x = planeData[arrayindex++];
            y = planeData[arrayindex++];
            z = planeData[arrayindex++];
            w = planeData[arrayindex++];
            normal = CSG.Vector3D.Create(x, y, z);
            plane = new CSG.Plane(normal, w);
            planes.push(plane);
        }

        var vertices = [],
            vertexData = bin.vertexData,
            numvertices = vertexData.length / 3,
            pos, vertex;
        arrayindex = 0;
        for (var vertexindex = 0; vertexindex < numvertices; vertexindex++) {
            x = vertexData[arrayindex++];
            y = vertexData[arrayindex++];
            z = vertexData[arrayindex++];
            pos = CSG.Vector3D.Create(x, y, z);
            vertex = new CSG.Vertex(pos);
            vertices.push(vertex);
        }

        var shareds = bin.shared.map(function(shared) {
            return CSG.Polygon.Shared.fromObject(shared);
        });

        var polygons = [],
            numpolygons = bin.numPolygons,
            numVerticesPerPolygon = bin.numVerticesPerPolygon,
            polygonVertices = bin.polygonVertices,
            polygonPlaneIndexes = bin.polygonPlaneIndexes,
            polygonSharedIndexes = bin.polygonSharedIndexes,
            numpolygonvertices, polygonvertices, shared, polygon; //already defined plane,
        arrayindex = 0;
        for (var polygonindex = 0; polygonindex < numpolygons; polygonindex++) {
            numpolygonvertices = numVerticesPerPolygon[polygonindex];
            polygonvertices = [];
            for (var i = 0; i < numpolygonvertices; i++) {
                polygonvertices.push(vertices[polygonVertices[arrayindex++]]);
            }
            plane = planes[polygonPlaneIndexes[polygonindex]];
            shared = shareds[polygonSharedIndexes[polygonindex]];
            polygon = new CSG.Polygon(polygonvertices, shared, plane);
            polygons.push(polygon);
        }
        var csg = CSG.fromPolygons(polygons);
        csg.isCanonicalized = true;
        csg.isRetesselated = true;
        return csg;
    };

    CSG.prototype = {
        toPolygons: function() {
            return this.polygons;
        },

        // Return a new CSG solid representing space in either this solid or in the
        // solid `csg`. Neither this solid nor the solid `csg` are modified.
        //
        //     A.union(B)
        //
        //     +-------+            +-------+
        //     |       |            |       |
        //     |   A   |            |       |
        //     |    +--+----+   =   |       +----+
        //     +----+--+    |       +----+       |
        //          |   B   |            |       |
        //          |       |            |       |
        //          +-------+            +-------+
        //
        union: function(csg) {
            var csgs;
            if (csg instanceof Array) {
                csgs = csg.slice(0);
                csgs.push(this);
            } else {
                csgs = [this, csg];
            }

            // combine csg pairs in a way that forms a balanced binary tree pattern
            for (var i = 1; i < csgs.length; i += 2) {
                csgs.push(csgs[i-1].unionSub(csgs[i]));
            }

            return csgs[i - 1].reTesselated().canonicalized();
        },

        unionSub: function(csg, retesselate, canonicalize) {
            if (!this.mayOverlap(csg)) {
                return this.unionForNonIntersecting(csg);
            } else {
                var a = new CSG.Tree(this.polygons);
                var b = new CSG.Tree(csg.polygons);
                a.clipTo(b, false);

                // b.clipTo(a, true); // ERROR: this doesn't work
                b.clipTo(a);
                b.invert();
                b.clipTo(a);
                b.invert();

                var newpolygons = a.allPolygons().concat(b.allPolygons());
                var result = CSG.fromPolygons(newpolygons);
                result.properties = this.properties._merge(csg.properties);
                if (retesselate) result = result.reTesselated();
                if (canonicalize) result = result.canonicalized();
                return result;
            }
        },

        // Like union, but when we know that the two solids are not intersecting
        // Do not use if you are not completely sure that the solids do not intersect!
        unionForNonIntersecting: function(csg) {
            var newpolygons = this.polygons.concat(csg.polygons);
            var result = CSG.fromPolygons(newpolygons);
            result.properties = this.properties._merge(csg.properties);
            result.isCanonicalized = this.isCanonicalized && csg.isCanonicalized;
            result.isRetesselated = this.isRetesselated && csg.isRetesselated;
            return result;
        },

        // Return a new CSG solid representing space in this solid but not in the
        // solid `csg`. Neither this solid nor the solid `csg` are modified.
        //
        //     A.subtract(B)
        //
        //     +-------+            +-------+
        //     |       |            |       |
        //     |   A   |            |       |
        //     |    +--+----+   =   |    +--+
        //     +----+--+    |       +----+
        //          |   B   |
        //          |       |
        //          +-------+
        //
        subtract: function(csg) {
            var csgs;
            if (csg instanceof Array) {
                csgs = csg;
            } else {
                csgs = [csg];
            }
            var result = this;
            for (var i = 0; i < csgs.length; i++) {
                var islast = (i == (csgs.length - 1));
                result = result.subtractSub(csgs[i], islast, islast);
            }
            return result;
        },

        subtractSub: function(csg, retesselate, canonicalize) {
            var a = new CSG.Tree(this.polygons);
            var b = new CSG.Tree(csg.polygons);
            a.invert();
            a.clipTo(b);
            b.clipTo(a, true);
            a.addPolygons(b.allPolygons());
            a.invert();
            var result = CSG.fromPolygons(a.allPolygons());
            result.properties = this.properties._merge(csg.properties);
            if (retesselate) result = result.reTesselated();
            if (canonicalize) result = result.canonicalized();
            return result;
        },

        // Return a new CSG solid representing space both this solid and in the
        // solid `csg`. Neither this solid nor the solid `csg` are modified.
        //
        //     A.intersect(B)
        //
        //     +-------+
        //     |       |
        //     |   A   |
        //     |    +--+----+   =   +--+
        //     +----+--+    |       +--+
        //          |   B   |
        //          |       |
        //          +-------+
        //
        intersect: function(csg) {
            var csgs;
            if (csg instanceof Array) {
                csgs = csg;
            } else {
                csgs = [csg];
            }
            var result = this;
            for (var i = 0; i < csgs.length; i++) {
                var islast = (i == (csgs.length - 1));
                result = result.intersectSub(csgs[i], islast, islast);
            }
            return result;
        },

        intersectSub: function(csg, retesselate, canonicalize) {
            var a = new CSG.Tree(this.polygons);
            var b = new CSG.Tree(csg.polygons);
            a.invert();
            b.clipTo(a);
            b.invert();
            a.clipTo(b);
            b.clipTo(a);
            a.addPolygons(b.allPolygons());
            a.invert();
            var result = CSG.fromPolygons(a.allPolygons());
            result.properties = this.properties._merge(csg.properties);
            if (retesselate) result = result.reTesselated();
            if (canonicalize) result = result.canonicalized();
            return result;
        },

        // Return a new CSG solid with solid and empty space switched. This solid is
        // not modified.
        invert: function() {
            var flippedpolygons = this.polygons.map(function(p) {
                return p.flipped();
            });
            return CSG.fromPolygons(flippedpolygons);
            // TODO: flip properties?
        },

        // Affine transformation of CSG object. Returns a new CSG object
        transform1: function(matrix4x4) {
            var newpolygons = this.polygons.map(function(p) {
                return p.transform(matrix4x4);
            });
            var result = CSG.fromPolygons(newpolygons);
            result.properties = this.properties._transform(matrix4x4);
            result.isRetesselated = this.isRetesselated;
            return result;
        },

        transform: function(matrix4x4) {
            var ismirror = matrix4x4.isMirroring();
            var transformedvertices = {};
            var transformedplanes = {};
            var newpolygons = this.polygons.map(function(p) {
                var newplane;
                var plane = p.plane;
                var planetag = plane.getTag();
                if (planetag in transformedplanes) {
                    newplane = transformedplanes[planetag];
                } else {
                    newplane = plane.transform(matrix4x4);
                    transformedplanes[planetag] = newplane;
                }
                var newvertices = p.vertices.map(function(v) {
                    var newvertex;
                    var vertextag = v.getTag();
                    if (vertextag in transformedvertices) {
                        newvertex = transformedvertices[vertextag];
                    } else {
                        newvertex = v.transform(matrix4x4);
                        transformedvertices[vertextag] = newvertex;
                    }
                    return newvertex;
                });
                if (ismirror) newvertices.reverse();
                return new CSG.Polygon(newvertices, p.shared, newplane);
            });
            var result = CSG.fromPolygons(newpolygons);
            result.properties = this.properties._transform(matrix4x4);
            result.isRetesselated = this.isRetesselated;
            result.isCanonicalized = this.isCanonicalized;
            return result;
        },

        toString: function() {
            var result = "CSG solid:\n";
            this.polygons.map(function(p) {
                result += p.toString();
            });
            return result;
        },

        // Expand the solid
        // resolution: number of points per 360 degree for the rounded corners
        expand: function(radius, resolution) {
            var result = this.expandedShell(radius, resolution, true);
            result = result.reTesselated();
            result.properties = this.properties; // keep original properties
            return result;
        },

        // Contract the solid
        // resolution: number of points per 360 degree for the rounded corners
        contract: function(radius, resolution) {
            var expandedshell = this.expandedShell(radius, resolution, false);
            var result = this.subtract(expandedshell);
            result = result.reTesselated();
            result.properties = this.properties; // keep original properties
            return result;
        },

        // cut the solid at a plane, and stretch the cross-section found along plane normal
        stretchAtPlane: function(normal, point, length) {
            var plane = CSG.Plane.fromNormalAndPoint(normal, point);
            var onb = new CSG.OrthoNormalBasis(plane);
            var crosssect = this.sectionCut(onb);
            var midpiece = crosssect.extrudeInOrthonormalBasis(onb, length);
            var piece1 = this.cutByPlane(plane);
            var piece2 = this.cutByPlane(plane.flipped());
            var result = piece1.union([midpiece, piece2.translate(plane.normal.times(length))]);
            return result;
        },


        // Create the expanded shell of the solid:
        // All faces are extruded to get a thickness of 2*radius
        // Cylinders are constructed around every side
        // Spheres are placed on every vertex
        // unionWithThis: if true, the resulting solid will be united with 'this' solid;
        //   the result is a true expansion of the solid
        //   If false, returns only the shell
        expandedShell: function(radius, resolution, unionWithThis) {
            var csg = this.reTesselated();
            var result;
            if (unionWithThis) {
                result = csg;
            } else {
                result = new CSG();
            }

            // first extrude all polygons:
            csg.polygons.map(function(polygon) {
                var extrudevector = polygon.plane.normal.unit().times(2 * radius);
                var translatedpolygon = polygon.translate(extrudevector.times(-0.5));
                var extrudedface = translatedpolygon.extrude(extrudevector);
                result = result.unionSub(extrudedface, false, false);
            });

            // Make a list of all unique vertex pairs (i.e. all sides of the solid)
            // For each vertex pair we collect the following:
            //   v1: first coordinate
            //   v2: second coordinate
            //   planenormals: array of normal vectors of all planes touching this side
            var vertexpairs = {}; // map of 'vertex pair tag' to {v1, v2, planenormals}
            csg.polygons.map(function(polygon) {
                var numvertices = polygon.vertices.length;
                var prevvertex = polygon.vertices[numvertices - 1];
                var prevvertextag = prevvertex.getTag();
                for (var i = 0; i < numvertices; i++) {
                    var vertex = polygon.vertices[i];
                    var vertextag = vertex.getTag();
                    var vertextagpair;
                    if (vertextag < prevvertextag) {
                        vertextagpair = vertextag + "-" + prevvertextag;
                    } else {
                        vertextagpair = prevvertextag + "-" + vertextag;
                    }
                    var obj;
                    if (vertextagpair in vertexpairs) {
                        obj = vertexpairs[vertextagpair];
                    } else {
                        obj = {
                            v1: prevvertex,
                            v2: vertex,
                            planenormals: []
                        };
                        vertexpairs[vertextagpair] = obj;
                    }
                    obj.planenormals.push(polygon.plane.normal);

                    prevvertextag = vertextag;
                    prevvertex = vertex;
                }
            });

            // now construct a cylinder on every side
            // The cylinder is always an approximation of a true cylinder: it will have <resolution> polygons
            // around the sides. We will make sure though that the cylinder will have an edge at every
            // face that touches this side. This ensures that we will get a smooth fill even
            // if two edges are at, say, 10 degrees and the resolution is low.
            // Note: the result is not retesselated yet but it really should be!
            for (var vertextagpair in vertexpairs) {
                var vertexpair = vertexpairs[vertextagpair],
                    startpoint = vertexpair.v1.pos,
                    endpoint = vertexpair.v2.pos,
                    // our x,y and z vectors:
                    zbase = endpoint.minus(startpoint).unit(),
                    xbase = vertexpair.planenormals[0].unit(),
                    ybase = xbase.cross(zbase),

                    // make a list of angles that the cylinder should traverse:
                    angles = [];

                // first of all equally spaced around the cylinder:
                for (var i = 0; i < resolution; i++) {
                    angles.push(i * Math.PI * 2 / resolution);
                }

                // and also at every normal of all touching planes:
                for (var i = 0, iMax = vertexpair.planenormals.length; i < iMax; i++) {
                    var planenormal = vertexpair.planenormals[i],
                        si = ybase.dot(planenormal),
                        co = xbase.dot(planenormal),
                        angle = Math.atan2(si, co);

                    if (angle < 0) angle += Math.PI * 2;
                    angles.push(angle);
                    angle = Math.atan2(-si, -co);
                    if (angle < 0) angle += Math.PI * 2;
                    angles.push(angle);
                }

                // this will result in some duplicate angles but we will get rid of those later.
                // Sort:
                angles = angles.sort(fnNumberSort);

                // Now construct the cylinder by traversing all angles:
                var numangles = angles.length,
                    prevp1, prevp2,
                    startfacevertices = [],
                    endfacevertices = [],
                    polygons = [];
                for (var i = -1; i < numangles; i++) {
                    var angle = angles[(i < 0) ? (i + numangles) : i],
                        si = Math.sin(angle),
                        co = Math.cos(angle),
                        p = xbase.times(co * radius).plus(ybase.times(si * radius)),
                        p1 = startpoint.plus(p),
                        p2 = endpoint.plus(p),
                        skip = false;
                    if (i >= 0) {
                        if (p1.distanceTo(prevp1) < 1e-5) {
                            skip = true;
                        }
                    }
                    if (!skip) {
                        if (i >= 0) {
                            startfacevertices.push(new CSG.Vertex(p1));
                            endfacevertices.push(new CSG.Vertex(p2));
                            var polygonvertices = [
                                new CSG.Vertex(prevp2),
                                new CSG.Vertex(p2),
                                new CSG.Vertex(p1),
                                new CSG.Vertex(prevp1)
                            ];
                            var polygon = new CSG.Polygon(polygonvertices);
                            polygons.push(polygon);
                        }
                        prevp1 = p1;
                        prevp2 = p2;
                    }
                }
                endfacevertices.reverse();
                polygons.push(new CSG.Polygon(startfacevertices));
                polygons.push(new CSG.Polygon(endfacevertices));
                var cylinder = CSG.fromPolygons(polygons);
                result = result.unionSub(cylinder, false, false);
            }

            // make a list of all unique vertices
            // For each vertex we also collect the list of normals of the planes touching the vertices
            var vertexmap = {};
            csg.polygons.map(function(polygon) {
                polygon.vertices.map(function(vertex) {
                    var vertextag = vertex.getTag();
                    var obj;
                    if (vertextag in vertexmap) {
                        obj = vertexmap[vertextag];
                    } else {
                        obj = {
                            pos: vertex.pos,
                            normals: []
                        };
                        vertexmap[vertextag] = obj;
                    }
                    obj.normals.push(polygon.plane.normal);
                });
            });

            // and build spheres at each vertex
            // We will try to set the x and z axis to the normals of 2 planes
            // This will ensure that our sphere tesselation somewhat matches 2 planes
            for (var vertextag in vertexmap) {
                var vertexobj = vertexmap[vertextag];
                // use the first normal to be the x axis of our sphere:
                var xaxis = vertexobj.normals[0].unit();
                // and find a suitable z axis. We will use the normal which is most perpendicular to the x axis:
                var bestzaxis = null;
                var bestzaxisorthogonality = 0;
                for (var i = 1; i < vertexobj.normals.length; i++) {
                    var normal = vertexobj.normals[i].unit();
                    var cross = xaxis.cross(normal);
                    var crosslength = cross.length();
                    if (crosslength > 0.05) {
                        if (crosslength > bestzaxisorthogonality) {
                            bestzaxisorthogonality = crosslength;
                            bestzaxis = normal;
                        }
                    }
                }
                if (!bestzaxis) {
                    bestzaxis = xaxis.randomNonParallelVector();
                }
                var yaxis = xaxis.cross(bestzaxis).unit();
                var zaxis = yaxis.cross(xaxis);
                var sphere = CSG.sphere({
                    center: vertexobj.pos,
                    radius: radius,
                    resolution: resolution,
                    axes: [xaxis, yaxis, zaxis]
                });
                result = result.unionSub(sphere, false, false);
            }

            return result;
        },

        canonicalized: function() {
            if (this.isCanonicalized) {
                return this;
            } else {
                var factory = new CSG.fuzzyCSGFactory();
                var result = factory.getCSG(this);
                result.isCanonicalized = true;
                result.isRetesselated = this.isRetesselated;
                result.properties = this.properties; // keep original properties
                return result;
            }
        },

        reTesselated: function() {
            if (this.isRetesselated) {
                return this;
            } else {
                var csg = this;
                var polygonsPerPlane = {};
                var isCanonicalized = csg.isCanonicalized;
                var fuzzyfactory = new CSG.fuzzyCSGFactory();
                csg.polygons.map(function(polygon) {
                    var plane = polygon.plane;
                    var shared = polygon.shared;
                    if (!isCanonicalized) {
                        // in order to identify to polygons having the same plane, we need to canonicalize the planes
                        // We don't have to do a full canonizalization (including vertices), to save time only do the planes and the shared data:
                        plane = fuzzyfactory.getPlane(plane);
                        shared = fuzzyfactory.getPolygonShared(shared);
                    }
                    var tag = plane.getTag() + "/" + shared.getTag();
                    if (!(tag in polygonsPerPlane)) {
                        polygonsPerPlane[tag] = [polygon];
                    } else {
                        polygonsPerPlane[tag].push(polygon);
                    }
                });
                var destpolygons = [];
                for (var planetag in polygonsPerPlane) {
                    var sourcepolygons = polygonsPerPlane[planetag];
                    if (sourcepolygons.length < 2) {
                        destpolygons = destpolygons.concat(sourcepolygons);
                    } else {
                        var retesselayedpolygons = [];
                        CSG.reTesselateCoplanarPolygons(sourcepolygons, retesselayedpolygons);
                        destpolygons = destpolygons.concat(retesselayedpolygons);
                    }
                }
                var result = CSG.fromPolygons(destpolygons);
                result.isRetesselated = true;
                // result = result.canonicalized();
                result.properties = this.properties; // keep original properties
                return result;
            }
        },

        // returns an array of two CSG.Vector3Ds (minimum coordinates and maximum coordinates)
        getBounds: function() {
            if (!this.cachedBoundingBox) {
                var minpoint = new CSG.Vector3D(0, 0, 0);
                var maxpoint = new CSG.Vector3D(0, 0, 0);
                var polygons = this.polygons;
                var numpolygons = polygons.length;
                for (var i = 0; i < numpolygons; i++) {
                    var polygon = polygons[i];
                    var bounds = polygon.boundingBox();
                    if (i === 0) {
                        minpoint = bounds[0];
                        maxpoint = bounds[1];
                    } else {
                        minpoint = minpoint.min(bounds[0]);
                        maxpoint = maxpoint.max(bounds[1]);
                    }
                }
                this.cachedBoundingBox = [minpoint, maxpoint];
            }
            return this.cachedBoundingBox;
        },

        // returns true if there is a possibility that the two solids overlap
        // returns false if we can be sure that they do not overlap
        mayOverlap: function(csg) {
            if ((this.polygons.length === 0) || (csg.polygons.length === 0)) {
                return false;
            } else {
                var mybounds = this.getBounds();
                var otherbounds = csg.getBounds();
                if (mybounds[1].x < otherbounds[0].x) return false;
                if (mybounds[0].x > otherbounds[1].x) return false;
                if (mybounds[1].y < otherbounds[0].y) return false;
                if (mybounds[0].y > otherbounds[1].y) return false;
                if (mybounds[1].z < otherbounds[0].z) return false;
                if (mybounds[0].z > otherbounds[1].z) return false;
                return true;
            }
        },

        // Cut the solid by a plane. Returns the solid on the back side of the plane
        cutByPlane: function(plane) {
            if (this.polygons.length === 0) {
                return new CSG();
            }
            // Ideally we would like to do an intersection with a polygon of inifinite size
            // but this is not supported by our implementation. As a workaround, we will create
            // a cube, with one face on the plane, and a size larger enough so that the entire
            // solid fits in the cube.
            // find the max distance of any vertex to the center of the plane:
            var planecenter = plane.normal.times(plane.w);
            var maxdistance = 0;
            this.polygons.map(function(polygon) {
                polygon.vertices.map(function(vertex) {
                    var distance = vertex.pos.distanceToSquared(planecenter);
                    if (distance > maxdistance) maxdistance = distance;
                });
            });
            maxdistance = Math.sqrt(maxdistance);
            maxdistance *= 1.01; // make sure it's really larger
            // Now build a polygon on the plane, at any point farther than maxdistance from the plane center:
            var vertices = [];
            var orthobasis = new CSG.OrthoNormalBasis(plane);
            vertices.push(new CSG.Vertex(orthobasis.to3D(new CSG.Vector2D(maxdistance, -maxdistance))));
            vertices.push(new CSG.Vertex(orthobasis.to3D(new CSG.Vector2D(-maxdistance, -maxdistance))));
            vertices.push(new CSG.Vertex(orthobasis.to3D(new CSG.Vector2D(-maxdistance, maxdistance))));
            vertices.push(new CSG.Vertex(orthobasis.to3D(new CSG.Vector2D(maxdistance, maxdistance))));
            var polygon = new CSG.Polygon(vertices, null, plane.flipped());

            // and extrude the polygon into a cube, backwards of the plane:
            var cube = polygon.extrude(plane.normal.times(-maxdistance));

            // Now we can do the intersection:
            var result = this.intersect(cube);
            result.properties = this.properties; // keep original properties
            return result;
        },

        // Connect a solid to another solid, such that two CSG.Connectors become connected
        //   myConnector: a CSG.Connector of this solid
        //   otherConnector: a CSG.Connector to which myConnector should be connected
        //   mirror: false: the 'axis' vectors of the connectors should point in the same direction
        //           true: the 'axis' vectors of the connectors should point in opposite direction
        //   normalrotation: degrees of rotation between the 'normal' vectors of the two
        //                   connectors
        connectTo: function(myConnector, otherConnector, mirror, normalrotation) {
            var matrix = myConnector.getTransformationTo(otherConnector, mirror, normalrotation);
            return this.transform(matrix);
        },

        // set the .shared property of all polygons
        // Returns a new CSG solid, the original is unmodified!
        setShared: function(shared) {
            var polygons = this.polygons.map(function(p) {
                return new CSG.Polygon(p.vertices, shared, p.plane);
            });
            var result = CSG.fromPolygons(polygons);
            result.properties = this.properties; // keep original properties
            result.isRetesselated = this.isRetesselated;
            result.isCanonicalized = this.isCanonicalized;
            return result;
        },

        setColor: function(args) {
            var newshared = CSG.Polygon.Shared.fromColor.apply(this, arguments);
            return this.setShared(newshared);
        },

        toCompactBinary: function() {
            var csg = this.canonicalized(),
                numpolygons = csg.polygons.length,
                numpolygonvertices = 0,
                numvertices = 0,
                vertexmap = {},
                vertices = [],
                numplanes = 0,
                planemap = {},
                polygonindex = 0,
                planes = [],
                shareds = [],
                sharedmap = {},
                numshared = 0;
            // for (var i = 0, iMax = csg.polygons.length; i < iMax; i++) {
            //  var p = csg.polygons[i];
            //  for (var j = 0, jMax = p.length; j < jMax; j++) {
            //      ++numpolygonvertices;
            //      var vertextag = p[j].getTag();
            //      if(!(vertextag in vertexmap)) {
            //          vertexmap[vertextag] = numvertices++;
            //          vertices.push(p[j]);
            //      }
            //  }
            csg.polygons.map(function(p) {
                p.vertices.map(function(v) {
                    ++numpolygonvertices;
                    var vertextag = v.getTag();
                    if (!(vertextag in vertexmap)) {
                        vertexmap[vertextag] = numvertices++;
                        vertices.push(v);
                    }
                });

                var planetag = p.plane.getTag();
                if (!(planetag in planemap)) {
                    planemap[planetag] = numplanes++;
                    planes.push(p.plane);
                }
                var sharedtag = p.shared.getTag();
                if (!(sharedtag in sharedmap)) {
                    sharedmap[sharedtag] = numshared++;
                    shareds.push(p.shared);
                }
            });
            var numVerticesPerPolygon = new Uint32Array(numpolygons),
                polygonSharedIndexes = new Uint32Array(numpolygons),
                polygonVertices = new Uint32Array(numpolygonvertices),
                polygonPlaneIndexes = new Uint32Array(numpolygons),
                vertexData = new Float64Array(numvertices * 3),
                planeData = new Float64Array(numplanes * 4),
                polygonVerticesIndex = 0;
            for (var polygonindex = 0; polygonindex < numpolygons; ++polygonindex) {
                var p = csg.polygons[polygonindex];
                numVerticesPerPolygon[polygonindex] = p.vertices.length;
                p.vertices.map(function(v) {
                    var vertextag = v.getTag();
                    var vertexindex = vertexmap[vertextag];
                    polygonVertices[polygonVerticesIndex++] = vertexindex;
                });
                var planetag = p.plane.getTag();
                var planeindex = planemap[planetag];
                polygonPlaneIndexes[polygonindex] = planeindex;
                var sharedtag = p.shared.getTag();
                var sharedindex = sharedmap[sharedtag];
                polygonSharedIndexes[polygonindex] = sharedindex;
            }
            var verticesArrayIndex = 0;
            vertices.map(function(v) {
                var pos = v.pos;
                vertexData[verticesArrayIndex++] = pos._x;
                vertexData[verticesArrayIndex++] = pos._y;
                vertexData[verticesArrayIndex++] = pos._z;
            });
            var planesArrayIndex = 0;
            planes.map(function(p) {
                var normal = p.normal;
                planeData[planesArrayIndex++] = normal._x;
                planeData[planesArrayIndex++] = normal._y;
                planeData[planesArrayIndex++] = normal._z;
                planeData[planesArrayIndex++] = p.w;
            });
            var result = {
                "class": "CSG",
                numPolygons: numpolygons,
                numVerticesPerPolygon: numVerticesPerPolygon,
                polygonPlaneIndexes: polygonPlaneIndexes,
                polygonSharedIndexes: polygonSharedIndexes,
                polygonVertices: polygonVertices,
                vertexData: vertexData,
                planeData: planeData,
                shared: shareds
            };
            return result;
        },

        // For debugging
        // Creates a new solid with a tiny cube at every vertex of the source solid
        toPointCloud: function(cuberadius) {
            var csg = this.reTesselated();

            var result = new CSG();

            // make a list of all unique vertices
            // For each vertex we also collect the list of normals of the planes touching the vertices
            var vertexmap = {};
            csg.polygons.map(function(polygon) {
                polygon.vertices.map(function(vertex) {
                    vertexmap[vertex.getTag()] = vertex.pos;
                });
            });

            for (var vertextag in vertexmap) {
                var pos = vertexmap[vertextag];
                var cube = CSG.cube({
                    center: pos,
                    radius: cuberadius
                });
                result = result.unionSub(cube, false, false);
            }
            result = result.reTesselated();
            return result;
        },

        // Get the transformation that transforms this CSG such that it is lying on the z=0 plane,
        // as flat as possible (i.e. the least z-height).
        // So that it is in an orientation suitable for CNC milling
        getTransformationAndInverseTransformationToFlatLying: function() {
            if (this.polygons.length === 0) {
                var m = new CSG.Matrix4x4(); // unity
                return [m,m];
            } else {
                // get a list of unique planes in the CSG:
                var csg = this.canonicalized();
                var planemap = {};
                csg.polygons.map(function(polygon) {
                    planemap[polygon.plane.getTag()] = polygon.plane;
                });
                // try each plane in the CSG and find the plane that, when we align it flat onto z=0,
                // gives the least height in z-direction.
                // If two planes give the same height, pick the plane that originally had a normal closest
                // to [0,0,-1].
                var xvector = new CSG.Vector3D(1, 0, 0);
                var yvector = new CSG.Vector3D(0, 1, 0);
                var zvector = new CSG.Vector3D(0, 0, 1);
                var z0connectorx = new CSG.Connector([0, 0, 0], [0, 0, -1], xvector);
                var z0connectory = new CSG.Connector([0, 0, 0], [0, 0, -1], yvector);
                var isfirst = true;
                var minheight = 0;
                var maxdotz = 0;
                var besttransformation, bestinversetransformation;
                for (var planetag in planemap) {
                    var plane = planemap[planetag];
                    var pointonplane = plane.normal.times(plane.w);
                    var transformation, inversetransformation;
                    // We need a normal vecrtor for the transformation
                    // determine which is more perpendicular to the plane normal: x or y?
                    // we will align this as much as possible to the x or y axis vector
                    var xorthogonality = plane.normal.cross(xvector).length();
                    var yorthogonality = plane.normal.cross(yvector).length();
                    if (xorthogonality > yorthogonality) {
                        // x is better:
                        var planeconnector = new CSG.Connector(pointonplane, plane.normal, xvector);
                        transformation = planeconnector.getTransformationTo(z0connectorx, false, 0);
                        inversetransformation = z0connectorx.getTransformationTo(planeconnector, false, 0);
                    } else {
                        // y is better:
                        var planeconnector = new CSG.Connector(pointonplane, plane.normal, yvector);
                        transformation = planeconnector.getTransformationTo(z0connectory, false, 0);
                        inversetransformation = z0connectory.getTransformationTo(planeconnector, false, 0);
                    }
                    var transformedcsg = csg.transform(transformation);
                    var dotz = -plane.normal.dot(zvector);
                    var bounds = transformedcsg.getBounds();
                    var zheight = bounds[1].z - bounds[0].z;
                    var isbetter = isfirst;
                    if (!isbetter) {
                        if (zheight < minheight) {
                            isbetter = true;
                        } else if (zheight == minheight) {
                            if (dotz > maxdotz) isbetter = true;
                        }
                    }
                    if (isbetter) {
                        // translate the transformation around the z-axis and onto the z plane:
                        var translation = new CSG.Vector3D([-0.5 * (bounds[1].x + bounds[0].x), -0.5 * (bounds[1].y + bounds[0].y), -bounds[0].z]);
                        transformation = transformation.multiply(CSG.Matrix4x4.translation(translation));
                        inversetransformation = CSG.Matrix4x4.translation(translation.negated()).multiply(inversetransformation);
                        minheight = zheight;
                        maxdotz = dotz;
                        besttransformation = transformation;
                        bestinversetransformation = inversetransformation;
                    }
                    isfirst = false;
                }
                return [besttransformation, bestinversetransformation];
            }
        },

        getTransformationToFlatLying: function() {
            var result = this.getTransformationAndInverseTransformationToFlatLying();
            return result[0];
        },

        lieFlat: function() {
            var transformation = this.getTransformationToFlatLying();
            return this.transform(transformation);
        },

        // project the 3D CSG onto a plane
        // This returns a 2D CAG with the 'shadow' shape of the 3D solid when projected onto the
        // plane represented by the orthonormal basis
        projectToOrthoNormalBasis: function(orthobasis) {
            var EPS = 1e-5;
            var cags = [];
            this.polygons.filter(function(p) {
                    // only return polys in plane, others may disturb result
                    return p.plane.normal.minus(orthobasis.plane.normal).lengthSquared() < EPS*EPS;
                })
                .map(function(polygon) {
                    var cag = polygon.projectToOrthoNormalBasis(orthobasis);
                    if (cag.sides.length > 0) {
                        cags.push(cag);
                    }
            });
            var result = new CAG().union(cags);
            return result;
        },

        sectionCut: function(orthobasis) {
            var EPS = 1e-5;
            var plane1 = orthobasis.plane;
            var plane2 = orthobasis.plane.flipped();
            plane1 = new CSG.Plane(plane1.normal, plane1.w);
            plane2 = new CSG.Plane(plane2.normal, plane2.w + 5*EPS);
            var cut3d = this.cutByPlane(plane1);
            cut3d = cut3d.cutByPlane(plane2);
            return cut3d.projectToOrthoNormalBasis(orthobasis);
        },

        /*
         fixTJunctions:

         Suppose we have two polygons ACDB and EDGF:

          A-----B
          |     |
          |     E--F
          |     |  |
          C-----D--G

         Note that vertex E forms a T-junction on the side BD. In this case some STL slicers will complain
         that the solid is not watertight. This is because the watertightness check is done by checking if
         each side DE is matched by another side ED.

         This function will return a new solid with ACDB replaced by ACDEB

         Note that this can create polygons that are slightly non-convex (due to rounding errors). Therefore the result should
         not be used for further CSG operations!
         */
        fixTJunctions: function() {
            var csg = this.canonicalized();
            var sidemap = {};
            for (var polygonindex = 0; polygonindex < csg.polygons.length; polygonindex++) {
                var polygon = csg.polygons[polygonindex];
                var numvertices = polygon.vertices.length;
                if (numvertices >= 3) // should be true
                {
                    var vertex = polygon.vertices[0];
                    var vertextag = vertex.getTag();
                    for (var vertexindex = 0; vertexindex < numvertices; vertexindex++) {
                        var nextvertexindex = vertexindex + 1;
                        if (nextvertexindex == numvertices) nextvertexindex = 0;
                        var nextvertex = polygon.vertices[nextvertexindex];
                        var nextvertextag = nextvertex.getTag();
                        var sidetag = vertextag + "/" + nextvertextag;
                        var reversesidetag = nextvertextag + "/" + vertextag;
                        if (reversesidetag in sidemap) {
                            // this side matches the same side in another polygon. Remove from sidemap:
                            var ar = sidemap[reversesidetag];
                            ar.splice(-1, 1);
                            if (ar.length === 0) {
                                delete sidemap[reversesidetag];
                            }
                        } else {
                            var sideobj = {
                                vertex0: vertex,
                                vertex1: nextvertex,
                                polygonindex: polygonindex
                            };
                            if (!(sidetag in sidemap)) {
                                sidemap[sidetag] = [sideobj];
                            } else {
                                sidemap[sidetag].push(sideobj);
                            }
                        }
                        vertex = nextvertex;
                        vertextag = nextvertextag;
                    }
                }
            }
            // now sidemap contains 'unmatched' sides
            // i.e. side AB in one polygon does not have a matching side BA in another polygon
            var vertextag2sidestart = {};
            var vertextag2sideend = {};
            var sidestocheck = {};
            var sidemapisempty = true;
            for (var sidetag in sidemap) {
                sidemapisempty = false;
                sidestocheck[sidetag] = true;
                sidemap[sidetag].map(function(sideobj) {
                    var starttag = sideobj.vertex0.getTag();
                    var endtag = sideobj.vertex1.getTag();
                    if (starttag in vertextag2sidestart) {
                        vertextag2sidestart[starttag].push(sidetag);
                    } else {
                        vertextag2sidestart[starttag] = [sidetag];
                    }
                    if (endtag in vertextag2sideend) {
                        vertextag2sideend[endtag].push(sidetag);
                    } else {
                        vertextag2sideend[endtag] = [sidetag];
                    }
                });
            }

            if (!sidemapisempty) {
                // make a copy of the polygons array, since we are going to modify it:
                var polygons = csg.polygons.slice(0);

                function addSide(vertex0, vertex1, polygonindex) {
                    var starttag = vertex0.getTag();
                    var endtag = vertex1.getTag();
                    if (starttag == endtag) throw new Error("Assertion failed");
                    var newsidetag = starttag + "/" + endtag;
                    var reversesidetag = endtag + "/" + starttag;
                    if (reversesidetag in sidemap) {
                        // we have a matching reverse oriented side.
                        // Instead of adding the new side, cancel out the reverse side:
                        // console.log("addSide("+newsidetag+") has reverse side:");
                        deleteSide(vertex1, vertex0, null);
                        return null;
                    }
                    //  console.log("addSide("+newsidetag+")");
                    var newsideobj = {
                        vertex0: vertex0,
                        vertex1: vertex1,
                        polygonindex: polygonindex
                    };
                    if (!(newsidetag in sidemap)) {
                        sidemap[newsidetag] = [newsideobj];
                    } else {
                        sidemap[newsidetag].push(newsideobj);
                    }
                    if (starttag in vertextag2sidestart) {
                        vertextag2sidestart[starttag].push(newsidetag);
                    } else {
                        vertextag2sidestart[starttag] = [newsidetag];
                    }
                    if (endtag in vertextag2sideend) {
                        vertextag2sideend[endtag].push(newsidetag);
                    } else {
                        vertextag2sideend[endtag] = [newsidetag];
                    }
                    return newsidetag;
                }

                function deleteSide(vertex0, vertex1, polygonindex) {
                    var starttag = vertex0.getTag();
                    var endtag = vertex1.getTag();
                    var sidetag = starttag + "/" + endtag;
                    // console.log("deleteSide("+sidetag+")");
                    if (!(sidetag in sidemap)) throw new Error("Assertion failed");
                    var idx = -1;
                    var sideobjs = sidemap[sidetag];
                    for (var i = 0; i < sideobjs.length; i++) {
                        var sideobj = sideobjs[i];
                        if (sideobj.vertex0 != vertex0) continue;
                        if (sideobj.vertex1 != vertex1) continue;
                        if (polygonindex !== null) {
                            if (sideobj.polygonindex != polygonindex) continue;
                        }
                        idx = i;
                        break;
                    }
                    if (idx < 0) throw new Error("Assertion failed");
                    sideobjs.splice(idx, 1);
                    if (sideobjs.length === 0) {
                        delete sidemap[sidetag];
                    }
                    idx = vertextag2sidestart[starttag].indexOf(sidetag);
                    if (idx < 0) throw new Error("Assertion failed");
                    vertextag2sidestart[starttag].splice(idx, 1);
                    if (vertextag2sidestart[starttag].length === 0) {
                        delete vertextag2sidestart[starttag];
                    }

                    idx = vertextag2sideend[endtag].indexOf(sidetag);
                    if (idx < 0) throw new Error("Assertion failed");
                    vertextag2sideend[endtag].splice(idx, 1);
                    if (vertextag2sideend[endtag].length === 0) {
                        delete vertextag2sideend[endtag];
                    }
                }


                while (true) {
                    var sidemapisempty = true;
                    for (var sidetag in sidemap) {
                        sidemapisempty = false;
                        sidestocheck[sidetag] = true;
                    }
                    if (sidemapisempty) break;
                    var donesomething = false;
                    while (true) {
                        var sidetagtocheck = null;
                        for (var sidetag in sidestocheck) {
                            sidetagtocheck = sidetag;
                            break;
                        }
                        if (sidetagtocheck === null) break; // sidestocheck is empty, we're done!
                        var donewithside = true;
                        if (sidetagtocheck in sidemap) {
                            var sideobjs = sidemap[sidetagtocheck];
                            if (sideobjs.length === 0) throw new Error("Assertion failed");
                            var sideobj = sideobjs[0];
                            for (var directionindex = 0; directionindex < 2; directionindex++) {
                                var startvertex = (directionindex === 0) ? sideobj.vertex0 : sideobj.vertex1;
                                var endvertex = (directionindex === 0) ? sideobj.vertex1 : sideobj.vertex0;
                                var startvertextag = startvertex.getTag();
                                var endvertextag = endvertex.getTag();
                                var matchingsides = [];
                                if (directionindex === 0) {
                                    if (startvertextag in vertextag2sideend) {
                                        matchingsides = vertextag2sideend[startvertextag];
                                    }
                                } else {
                                    if (startvertextag in vertextag2sidestart) {
                                        matchingsides = vertextag2sidestart[startvertextag];
                                    }
                                }
                                for (var matchingsideindex = 0; matchingsideindex < matchingsides.length; matchingsideindex++) {
                                    var matchingsidetag = matchingsides[matchingsideindex];
                                    var matchingside = sidemap[matchingsidetag][0];
                                    var matchingsidestartvertex = (directionindex === 0) ? matchingside.vertex0 : matchingside.vertex1;
                                    var matchingsideendvertex = (directionindex === 0) ? matchingside.vertex1 : matchingside.vertex0;
                                    var matchingsidestartvertextag = matchingsidestartvertex.getTag();
                                    var matchingsideendvertextag = matchingsideendvertex.getTag();
                                    if (matchingsideendvertextag != startvertextag) throw new Error("Assertion failed");
                                    if (matchingsidestartvertextag == endvertextag) {
                                        // matchingside cancels sidetagtocheck
                                        deleteSide(startvertex, endvertex, null);
                                        deleteSide(endvertex, startvertex, null);
                                        donewithside = false;
                                        directionindex = 2; // skip reverse direction check
                                        donesomething = true;
                                        break;
                                    } else {
                                        var startpos = startvertex.pos;
                                        var endpos = endvertex.pos;
                                        var checkpos = matchingsidestartvertex.pos;
                                        var direction = checkpos.minus(startpos);
                                        // Now we need to check if endpos is on the line startpos-checkpos:
                                        var t = endpos.minus(startpos).dot(direction) / direction.dot(direction);
                                        if ((t > 0) && (t < 1)) {
                                            var closestpoint = startpos.plus(direction.times(t));
                                            var distancesquared = closestpoint.distanceToSquared(endpos);
                                            if (distancesquared < 1e-10) {
                                                // Yes it's a t-junction! We need to split matchingside in two:
                                                var polygonindex = matchingside.polygonindex;
                                                var polygon = polygons[polygonindex];
                                                // find the index of startvertextag in polygon:
                                                var insertionvertextag = matchingside.vertex1.getTag();
                                                var insertionvertextagindex = -1;
                                                for (var i = 0; i < polygon.vertices.length; i++) {
                                                    if (polygon.vertices[i].getTag() == insertionvertextag) {
                                                        insertionvertextagindex = i;
                                                        break;
                                                    }
                                                }
                                                if (insertionvertextagindex < 0) throw new Error("Assertion failed");
                                                // split the side by inserting the vertex:
                                                var newvertices = polygon.vertices.slice(0);
                                                newvertices.splice(insertionvertextagindex, 0, endvertex);
                                                var newpolygon = new CSG.Polygon(newvertices, polygon.shared /*polygon.plane*/ );

// FIX
                                               //calculate plane with differents point
                                                if(isNaN(newpolygon.plane.w)){

                                                    var found = false,
                                                        loop = function(callback){
                                                            newpolygon.vertices.forEach(function(item){
                                                                if(found) return;
                                                                callback(item);
                                                            })
                                                        };

                                                    loop(function(a){
                                                        loop(function(b) {
                                                            loop(function (c) {
                                                                newpolygon.plane = CSG.Plane.fromPoints(a.pos, b.pos, c.pos)
                                                                if(!isNaN(newpolygon.plane.w)) {
                                                                    found = true;
                                                                }
                                                            })
                                                        })
                                                    })
                                                }
// FIX

                                                polygons[polygonindex] = newpolygon;

                                                // remove the original sides from our maps:
                                                // deleteSide(sideobj.vertex0, sideobj.vertex1, null);
                                                deleteSide(matchingside.vertex0, matchingside.vertex1, polygonindex);
                                                var newsidetag1 = addSide(matchingside.vertex0, endvertex, polygonindex);
                                                var newsidetag2 = addSide(endvertex, matchingside.vertex1, polygonindex);
                                                if (newsidetag1 !== null) sidestocheck[newsidetag1] = true;
                                                if (newsidetag2 !== null) sidestocheck[newsidetag2] = true;
                                                donewithside = false;
                                                directionindex = 2; // skip reverse direction check
                                                donesomething = true;
                                                break;
                                            } // if(distancesquared < 1e-10)
                                        } // if( (t > 0) && (t < 1) )
                                    } // if(endingstidestartvertextag == endvertextag)
                                } // for matchingsideindex
                            } // for directionindex
                        } // if(sidetagtocheck in sidemap)
                        if (donewithside) {
                            delete sidestocheck[sidetag];
                        }
                    }
                    if (!donesomething) break;
                }
                var newcsg = CSG.fromPolygons(polygons);
                newcsg.properties = csg.properties;
                newcsg.isCanonicalized = true;
                newcsg.isRetesselated = true;
                csg = newcsg;
            } // if(!sidemapisempty)
            var sidemapisempty = true;
            for (var sidetag in sidemap) {
                sidemapisempty = false;
                break;
            }
            if (!sidemapisempty) {
                // throw new Error("!sidemapisempty");
            OpenJsCad.log("!sidemapisempty");
            }
            return csg;
        },

        toTriangles: function() {
            var polygons = [];
            this.polygons.forEach(function(poly) {
                var firstVertex = poly.vertices[0];
                for (var i = poly.vertices.length - 3; i >= 0; i--) {
                    polygons.push(new CSG.Polygon([
                            firstVertex, poly.vertices[i + 1], poly.vertices[i + 2]
                        ],
                        poly.shared, poly.plane));
                }
            });
            return polygons;
        },

        // features: string, or array containing 1 or more strings of: 'volume', 'area'
        // more could be added here (Fourier coeff, moments)
        getFeatures: function(features) {
            if (!(features instanceof Array)) {
                features = [features];
            }
            var result = this.toTriangles().map(function(triPoly) {
                    return triPoly.getTetraFeatures(features);
                })
                .reduce(function(pv, v) {
                    return v.map(function(feat, i) {
                        return feat + (pv === 0 ? 0 : pv[i]);
                    });
                }, 0);
            return (result.length == 1) ? result[0] : result;
        }
    };

    // Parse an option from the options object
    // If the option is not present, return the default value
    CSG.parseOption = function(options, optionname, defaultvalue) {
        var result = defaultvalue;
        if (options) {
            if (optionname in options) {
                result = options[optionname];
            }
        }
        return result;
    };

    // Parse an option and force into a CSG.Vector3D. If a scalar is passed it is converted
    // into a vector with equal x,y,z
    CSG.parseOptionAs3DVector = function(options, optionname, defaultvalue) {
        var result = CSG.parseOption(options, optionname, defaultvalue);
        result = new CSG.Vector3D(result);
        return result;
    };

    CSG.parseOptionAs3DVectorList = function(options, optionname, defaultvalue) {
        var result = CSG.parseOption(options, optionname, defaultvalue);
        return result.map(function(res) {
            return new CSG.Vector3D(res);
        });
    };

    // Parse an option and force into a CSG.Vector2D. If a scalar is passed it is converted
    // into a vector with equal x,y
    CSG.parseOptionAs2DVector = function(options, optionname, defaultvalue) {
        var result = CSG.parseOption(options, optionname, defaultvalue);
        result = new CSG.Vector2D(result);
        return result;
    };

    CSG.parseOptionAsFloat = function(options, optionname, defaultvalue) {
        var result = CSG.parseOption(options, optionname, defaultvalue);
        if (typeof(result) == "string") {
            result = Number(result);
        }
        if (isNaN(result) || typeof(result) != "number") {
            throw new Error("Parameter " + optionname + " should be a number");
        }
        return result;
    };

    CSG.parseOptionAsInt = function(options, optionname, defaultvalue) {
        var result = CSG.parseOption(options, optionname, defaultvalue);
        result = Number(Math.floor(result));
        if (isNaN(result)) {
            throw new Error("Parameter " + optionname + " should be a number");
        }
        return result;
    };

    CSG.parseOptionAsBool = function(options, optionname, defaultvalue) {
        var result = CSG.parseOption(options, optionname, defaultvalue);
        if (typeof(result) == "string") {
            if (result == "true") result = true;
            else if (result == "false") result = false;
            else if (result == 0) result = false;
        }
        result = !!result;
        return result;
    };

    // Construct an axis-aligned solid cuboid.
    // Parameters:
    //   center: center of cube (default [0,0,0])
    //   radius: radius of cube (default [1,1,1]), can be specified as scalar or as 3D vector
    //
    // Example code:
    //
    //     var cube = CSG.cube({
    //       center: [0, 0, 0],
    //       radius: 1
    //     });
    CSG.cube = function(options) {
        var c, r;
        options = options || {};
        if (('corner1' in options) || ('corner2' in options)) {
            if (('center' in options) || ('radius' in options)) {
                throw new Error("cube: should either give a radius and center parameter, or a corner1 and corner2 parameter")
            }
            corner1 = CSG.parseOptionAs3DVector(options, "corner1", [0, 0, 0]);
            corner2 = CSG.parseOptionAs3DVector(options, "corner2", [1, 1, 1]);
            c = corner1.plus(corner2).times(0.5);
            r = corner2.minus(corner1).times(0.5);
        } else {
            c = CSG.parseOptionAs3DVector(options, "center", [0, 0, 0]);
            r = CSG.parseOptionAs3DVector(options, "radius", [1, 1, 1]);
        }
        r = r.abs(); // negative radii make no sense
        var result = CSG.fromPolygons([
            [
                [0, 4, 6, 2],
                [-1, 0, 0]
            ],
            [
                [1, 3, 7, 5],
                [+1, 0, 0]
            ],
            [
                [0, 1, 5, 4],
                [0, -1, 0]
            ],
            [
                [2, 6, 7, 3],
                [0, +1, 0]
            ],
            [
                [0, 2, 3, 1],
                [0, 0, -1]
            ],
            [
                [4, 5, 7, 6],
                [0, 0, +1]
            ]
        ].map(function(info) {
            //var normal = new CSG.Vector3D(info[1]);
            //var plane = new CSG.Plane(normal, 1);
            var vertices = info[0].map(function(i) {
                var pos = new CSG.Vector3D(
                    c.x + r.x * (2 * !!(i & 1) - 1), c.y + r.y * (2 * !!(i & 2) - 1), c.z + r.z * (2 * !!(i & 4) - 1));
                return new CSG.Vertex(pos);
            });
            return new CSG.Polygon(vertices, null /* , plane */ );
        }));
        result.properties.cube = new CSG.Properties();
        result.properties.cube.center = new CSG.Vector3D(c);
        // add 6 connectors, at the centers of each face:
        result.properties.cube.facecenters = [
            new CSG.Connector(new CSG.Vector3D([r.x, 0, 0]).plus(c), [1, 0, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([-r.x, 0, 0]).plus(c), [-1, 0, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([0, r.y, 0]).plus(c), [0, 1, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([0, -r.y, 0]).plus(c), [0, -1, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([0, 0, r.z]).plus(c), [0, 0, 1], [1, 0, 0]),
            new CSG.Connector(new CSG.Vector3D([0, 0, -r.z]).plus(c), [0, 0, -1], [1, 0, 0])
        ];
        return result;
    };

    // Construct a solid sphere
    //
    // Parameters:
    //   center: center of sphere (default [0,0,0])
    //   radius: radius of sphere (default 1), must be a scalar
    //   resolution: determines the number of polygons per 360 degree revolution (default 12)
    //   axes: (optional) an array with 3 vectors for the x, y and z base vectors
    //
    // Example usage:
    //
    //     var sphere = CSG.sphere({
    //       center: [0, 0, 0],
    //       radius: 2,
    //       resolution: 32,
    //     });
    CSG.sphere = function(options) {
        options = options || {};
        var center = CSG.parseOptionAs3DVector(options, "center", [0, 0, 0]);
        var radius = CSG.parseOptionAsFloat(options, "radius", 1);
        var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution3D);
        var xvector, yvector, zvector;
        if ('axes' in options) {
            xvector = options.axes[0].unit().times(radius);
            yvector = options.axes[1].unit().times(radius);
            zvector = options.axes[2].unit().times(radius);
        } else {
            xvector = new CSG.Vector3D([1, 0, 0]).times(radius);
            yvector = new CSG.Vector3D([0, -1, 0]).times(radius);
            zvector = new CSG.Vector3D([0, 0, 1]).times(radius);
        }
        if (resolution < 4) resolution = 4;
        var qresolution = Math.round(resolution / 4);
        var prevcylinderpoint;
        var polygons = [];
        for (var slice1 = 0; slice1 <= resolution; slice1++) {
            var angle = Math.PI * 2.0 * slice1 / resolution;
            var cylinderpoint = xvector.times(Math.cos(angle)).plus(yvector.times(Math.sin(angle)));
            if (slice1 > 0) {
                // cylinder vertices:
                var vertices = [];
                var prevcospitch, prevsinpitch;
                for (var slice2 = 0; slice2 <= qresolution; slice2++) {
                    var pitch = 0.5 * Math.PI * slice2 / qresolution;
                    var cospitch = Math.cos(pitch);
                    var sinpitch = Math.sin(pitch);
                    if (slice2 > 0) {
                        vertices = [];
                        vertices.push(new CSG.Vertex(center.plus(prevcylinderpoint.times(prevcospitch).minus(zvector.times(prevsinpitch)))));
                        vertices.push(new CSG.Vertex(center.plus(cylinderpoint.times(prevcospitch).minus(zvector.times(prevsinpitch)))));
                        if (slice2 < qresolution) {
                            vertices.push(new CSG.Vertex(center.plus(cylinderpoint.times(cospitch).minus(zvector.times(sinpitch)))));
                        }
                        vertices.push(new CSG.Vertex(center.plus(prevcylinderpoint.times(cospitch).minus(zvector.times(sinpitch)))));
                        polygons.push(new CSG.Polygon(vertices));
                        vertices = [];
                        vertices.push(new CSG.Vertex(center.plus(prevcylinderpoint.times(prevcospitch).plus(zvector.times(prevsinpitch)))));
                        vertices.push(new CSG.Vertex(center.plus(cylinderpoint.times(prevcospitch).plus(zvector.times(prevsinpitch)))));
                        if (slice2 < qresolution) {
                            vertices.push(new CSG.Vertex(center.plus(cylinderpoint.times(cospitch).plus(zvector.times(sinpitch)))));
                        }
                        vertices.push(new CSG.Vertex(center.plus(prevcylinderpoint.times(cospitch).plus(zvector.times(sinpitch)))));
                        vertices.reverse();
                        polygons.push(new CSG.Polygon(vertices));
                    }
                    prevcospitch = cospitch;
                    prevsinpitch = sinpitch;
                }
            }
            prevcylinderpoint = cylinderpoint;
        }
        var result = CSG.fromPolygons(polygons);
        result.properties.sphere = new CSG.Properties();
        result.properties.sphere.center = new CSG.Vector3D(center);
        result.properties.sphere.facepoint = center.plus(xvector);
        return result;
    };

    // Construct a solid cylinder.
    //
    // Parameters:
    //   start: start point of cylinder (default [0, -1, 0])
    //   end: end point of cylinder (default [0, 1, 0])
    //   radius: radius of cylinder (default 1), must be a scalar
    //   resolution: determines the number of polygons per 360 degree revolution (default 12)
    //
    // Example usage:
    //
    //     var cylinder = CSG.cylinder({
    //       start: [0, -1, 0],
    //       end: [0, 1, 0],
    //       radius: 1,
    //       resolution: 16
    //     });
    CSG.cylinder = function(options) {
        var s = CSG.parseOptionAs3DVector(options, "start", [0, -1, 0]);
        var e = CSG.parseOptionAs3DVector(options, "end", [0, 1, 0]);
        var r = CSG.parseOptionAsFloat(options, "radius", 1);
        var rEnd = CSG.parseOptionAsFloat(options, "radiusEnd", r);
        var rStart = CSG.parseOptionAsFloat(options, "radiusStart", r);
        var alpha = CSG.parseOptionAsFloat(options, "sectorAngle", 360);
        alpha = alpha > 360 ? alpha % 360 : alpha;

        if ((rEnd < 0) || (rStart < 0)) {
            throw new Error("Radius should be non-negative");
        }
        if ((rEnd === 0) && (rStart === 0)) {
            throw new Error("Either radiusStart or radiusEnd should be positive");
        }

        var slices = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution2D);
        var ray = e.minus(s);
        var axisZ = ray.unit(); //, isY = (Math.abs(axisZ.y) > 0.5);
        var axisX = axisZ.randomNonParallelVector().unit();

        //  var axisX = new CSG.Vector3D(isY, !isY, 0).cross(axisZ).unit();
        var axisY = axisX.cross(axisZ).unit();
        var start = new CSG.Vertex(s);
        var end = new CSG.Vertex(e);
        var polygons = [];

        function point(stack, slice, radius) {
            var angle = slice * Math.PI * alpha / 180;
            var out = axisX.times(Math.cos(angle)).plus(axisY.times(Math.sin(angle)));
            var pos = s.plus(ray.times(stack)).plus(out.times(radius));
            return new CSG.Vertex(pos);
        }
        if (alpha > 0) {
            for (var i = 0; i < slices; i++) {
                var t0 = i / slices,
                    t1 = (i + 1) / slices;
                if (rEnd == rStart) {
                    polygons.push(new CSG.Polygon([start, point(0, t0, rEnd), point(0, t1, rEnd)]));
                    polygons.push(new CSG.Polygon([point(0, t1, rEnd), point(0, t0, rEnd), point(1, t0, rEnd), point(1, t1, rEnd)]));
                    polygons.push(new CSG.Polygon([end, point(1, t1, rEnd), point(1, t0, rEnd)]));
                } else {
                    if (rStart > 0) {
                        polygons.push(new CSG.Polygon([start, point(0, t0, rStart), point(0, t1, rStart)]));
                        polygons.push(new CSG.Polygon([point(0, t0, rStart), point(1, t0, rEnd), point(0, t1, rStart)]));
                    }
                    if (rEnd > 0) {
                        polygons.push(new CSG.Polygon([end, point(1, t1, rEnd), point(1, t0, rEnd)]));
                        polygons.push(new CSG.Polygon([point(1, t0, rEnd), point(1, t1, rEnd), point(0, t1, rStart)]));
                    }
                }
            }
            if (alpha < 360) {
                polygons.push(new CSG.Polygon([start, end, point(0, 0, rStart)]));
                polygons.push(new CSG.Polygon([point(0, 0, rStart), end, point(1, 0, rEnd)]));
                polygons.push(new CSG.Polygon([start, point(0, 1, rStart), end]));
                polygons.push(new CSG.Polygon([point(0, 1, rStart), point(1, 1, rEnd), end]));
            }
        }
        var result = CSG.fromPolygons(polygons);
        result.properties.cylinder = new CSG.Properties();
        result.properties.cylinder.start = new CSG.Connector(s, axisZ.negated(), axisX);
        result.properties.cylinder.end = new CSG.Connector(e, axisZ, axisX);
        var cylCenter = s.plus(ray.times(0.5));
        var fptVec = axisX.rotate(s, axisZ, -alpha / 2).times((rStart + rEnd) / 2);
        var fptVec90 = fptVec.cross(axisZ);
        // note this one is NOT a face normal for a cone. - It's horizontal from cyl perspective
        result.properties.cylinder.facepointH = new CSG.Connector(cylCenter.plus(fptVec), fptVec, axisZ);
        result.properties.cylinder.facepointH90 = new CSG.Connector(cylCenter.plus(fptVec90), fptVec90, axisZ);
        return result;
    };

    // Like a cylinder, but with rounded ends instead of flat
    //
    // Parameters:
    //   start: start point of cylinder (default [0, -1, 0])
    //   end: end point of cylinder (default [0, 1, 0])
    //   radius: radius of cylinder (default 1), must be a scalar
    //   resolution: determines the number of polygons per 360 degree revolution (default 12)
    //   normal: a vector determining the starting angle for tesselation. Should be non-parallel to start.minus(end)
    //
    // Example usage:
    //
    //     var cylinder = CSG.roundedCylinder({
    //       start: [0, -1, 0],
    //       end: [0, 1, 0],
    //       radius: 1,
    //       resolution: 16
    //     });
    CSG.roundedCylinder = function(options) {
        var p1 = CSG.parseOptionAs3DVector(options, "start", [0, -1, 0]);
        var p2 = CSG.parseOptionAs3DVector(options, "end", [0, 1, 0]);
        var radius = CSG.parseOptionAsFloat(options, "radius", 1);
        var direction = p2.minus(p1);
        var defaultnormal;
        if (Math.abs(direction.x) > Math.abs(direction.y)) {
            defaultnormal = new CSG.Vector3D(0, 1, 0);
        } else {
            defaultnormal = new CSG.Vector3D(1, 0, 0);
        }
        var normal = CSG.parseOptionAs3DVector(options, "normal", defaultnormal);
        var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution3D);
        if (resolution < 4) resolution = 4;
        var polygons = [];
        var qresolution = Math.floor(0.25 * resolution);
        var length = direction.length();
        if (length < 1e-10) {
            return CSG.sphere({
                center: p1,
                radius: radius,
                resolution: resolution
            });
        }
        var zvector = direction.unit().times(radius);
        var xvector = zvector.cross(normal).unit().times(radius);
        var yvector = xvector.cross(zvector).unit().times(radius);
        var prevcylinderpoint;
        for (var slice1 = 0; slice1 <= resolution; slice1++) {
            var angle = Math.PI * 2.0 * slice1 / resolution;
            var cylinderpoint = xvector.times(Math.cos(angle)).plus(yvector.times(Math.sin(angle)));
            if (slice1 > 0) {
                // cylinder vertices:
                var vertices = [];
                vertices.push(new CSG.Vertex(p1.plus(cylinderpoint)));
                vertices.push(new CSG.Vertex(p1.plus(prevcylinderpoint)));
                vertices.push(new CSG.Vertex(p2.plus(prevcylinderpoint)));
                vertices.push(new CSG.Vertex(p2.plus(cylinderpoint)));
                polygons.push(new CSG.Polygon(vertices));
                var prevcospitch, prevsinpitch;
                for (var slice2 = 0; slice2 <= qresolution; slice2++) {
                    var pitch = 0.5 * Math.PI * slice2 / qresolution;
                    //var pitch = Math.asin(slice2/qresolution);
                    var cospitch = Math.cos(pitch);
                    var sinpitch = Math.sin(pitch);
                    if (slice2 > 0) {
                        vertices = [];
                        vertices.push(new CSG.Vertex(p1.plus(prevcylinderpoint.times(prevcospitch).minus(zvector.times(prevsinpitch)))));
                        vertices.push(new CSG.Vertex(p1.plus(cylinderpoint.times(prevcospitch).minus(zvector.times(prevsinpitch)))));
                        if (slice2 < qresolution) {
                            vertices.push(new CSG.Vertex(p1.plus(cylinderpoint.times(cospitch).minus(zvector.times(sinpitch)))));
                        }
                        vertices.push(new CSG.Vertex(p1.plus(prevcylinderpoint.times(cospitch).minus(zvector.times(sinpitch)))));
                        polygons.push(new CSG.Polygon(vertices));
                        vertices = [];
                        vertices.push(new CSG.Vertex(p2.plus(prevcylinderpoint.times(prevcospitch).plus(zvector.times(prevsinpitch)))));
                        vertices.push(new CSG.Vertex(p2.plus(cylinderpoint.times(prevcospitch).plus(zvector.times(prevsinpitch)))));
                        if (slice2 < qresolution) {
                            vertices.push(new CSG.Vertex(p2.plus(cylinderpoint.times(cospitch).plus(zvector.times(sinpitch)))));
                        }
                        vertices.push(new CSG.Vertex(p2.plus(prevcylinderpoint.times(cospitch).plus(zvector.times(sinpitch)))));
                        vertices.reverse();
                        polygons.push(new CSG.Polygon(vertices));
                    }
                    prevcospitch = cospitch;
                    prevsinpitch = sinpitch;
                }
            }
            prevcylinderpoint = cylinderpoint;
        }
        var result = CSG.fromPolygons(polygons);
        var ray = zvector.unit();
        var axisX = xvector.unit();
        result.properties.roundedCylinder = new CSG.Properties();
        result.properties.roundedCylinder.start = new CSG.Connector(p1, ray.negated(), axisX);
        result.properties.roundedCylinder.end = new CSG.Connector(p2, ray, axisX);
        result.properties.roundedCylinder.facepoint = p1.plus(xvector);
        return result;
    };

    // Construct an axis-aligned solid rounded cuboid.
    // Parameters:
    //   center: center of cube (default [0,0,0])
    //   radius: radius of cube (default [1,1,1]), can be specified as scalar or as 3D vector
    //   roundradius: radius of rounded corners (default 0.2), must be a scalar
    //   resolution: determines the number of polygons per 360 degree revolution (default 8)
    //
    // Example code:
    //
    //     var cube = CSG.roundedCube({
    //       center: [0, 0, 0],
    //       radius: 1,
    //       roundradius: 0.2,
    //       resolution: 8,
    //     });
    CSG.roundedCube = function(options) {
        var EPS = 1e-5;
        var minRR = 1e-2; //minroundradius 1e-3 gives rounding errors already
        var center, cuberadius;
        options = options || {};
        if (('corner1' in options) || ('corner2' in options)) {
            if (('center' in options) || ('radius' in options)) {
                throw new Error("roundedCube: should either give a radius and center parameter, or a corner1 and corner2 parameter");
            }
            corner1 = CSG.parseOptionAs3DVector(options, "corner1", [0, 0, 0]);
            corner2 = CSG.parseOptionAs3DVector(options, "corner2", [1, 1, 1]);
            center = corner1.plus(corner2).times(0.5);
            cuberadius = corner2.minus(corner1).times(0.5);
        } else {
            center = CSG.parseOptionAs3DVector(options, "center", [0, 0, 0]);
            cuberadius = CSG.parseOptionAs3DVector(options, "radius", [1, 1, 1]);
        }
        cuberadius = cuberadius.abs(); // negative radii make no sense
        var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution3D);
        if (resolution < 4) resolution = 4;
        if (resolution%2 == 1 && resolution < 8) resolution = 8; // avoid ugly
        var roundradius = CSG.parseOptionAs3DVector(options, "roundradius", [0.2, 0.2, 0.2]);
        // slight hack for now - total radius stays ok
        roundradius = CSG.Vector3D.Create(Math.max(roundradius.x, minRR), Math.max(roundradius.y, minRR), Math.max(roundradius.z, minRR));
        var innerradius = cuberadius.minus(roundradius);
        if (innerradius.x < 0 || innerradius.y < 0 || innerradius.z < 0) {
            throw('roundradius <= radius!');
        }
        var res = CSG.sphere({radius:1, resolution:resolution});
        res = res.scale(roundradius);
        innerradius.x > EPS && (res = res.stretchAtPlane([1, 0, 0], [0, 0, 0], 2*innerradius.x));
        innerradius.y > EPS && (res = res.stretchAtPlane([0, 1, 0], [0, 0, 0], 2*innerradius.y));
        innerradius.z > EPS && (res = res.stretchAtPlane([0, 0, 1], [0, 0, 0], 2*innerradius.z));
        res = res.translate([-innerradius.x+center.x, -innerradius.y+center.y, -innerradius.z+center.z]);
        res = res.reTesselated();
        res.properties.roundedCube = new CSG.Properties();
        res.properties.roundedCube.center = new CSG.Vertex(center);
        res.properties.roundedCube.facecenters = [
            new CSG.Connector(new CSG.Vector3D([cuberadius.x, 0, 0]).plus(center), [1, 0, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([-cuberadius.x, 0, 0]).plus(center), [-1, 0, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([0, cuberadius.y, 0]).plus(center), [0, 1, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([0, -cuberadius.y, 0]).plus(center), [0, -1, 0], [0, 0, 1]),
            new CSG.Connector(new CSG.Vector3D([0, 0, cuberadius.z]).plus(center), [0, 0, 1], [1, 0, 0]),
            new CSG.Connector(new CSG.Vector3D([0, 0, -cuberadius.z]).plus(center), [0, 0, -1], [1, 0, 0])
        ];
        return res;
    };

    /**
     * polyhedron accepts openscad style arguments. I.e. define face vertices clockwise looking from outside
     */
    CSG.polyhedron = function(options) {
        options = options || {};
        if (('points' in options) !== ('faces' in options)) {
            throw new Error("polyhedron needs 'points' and 'faces' arrays");
        }
        var vertices = CSG.parseOptionAs3DVectorList(options, "points", [
                [1, 1, 0],
                [1, -1, 0],
                [-1, -1, 0],
                [-1, 1, 0],
                [0, 0, 1]
            ])
            .map(function(pt) {
                return new CSG.Vertex(pt);
            });
        var faces = CSG.parseOption(options, "faces", [
                [0, 1, 4],
                [1, 2, 4],
                [2, 3, 4],
                [3, 0, 4],
                [1, 0, 3],
                [2, 1, 3]
            ]);
        // openscad convention defines inward normals - so we have to invert here
        faces.forEach(function(face) {
            face.reverse();
        });
        var polygons = faces.map(function(face) {
            return new CSG.Polygon(face.map(function(idx) {
                return vertices[idx];
            }));
        });

        // TODO: facecenters as connectors? probably overkill. Maybe centroid
        // the re-tesselation here happens because it's so easy for a user to
        // create parametrized polyhedrons that end up with 1-2 dimensional polygons.
        // These will create infinite loops at CSG.Tree()
        return CSG.fromPolygons(polygons).reTesselated();
    };

    CSG.IsFloat = function(n) {
        return (!isNaN(n)) || (n === Infinity) || (n === -Infinity);
    };

    // solve 2x2 linear equation:
    // [ab][x] = [u]
    // [cd][y]   [v]
    CSG.solve2Linear = function(a, b, c, d, u, v) {
        var det = a * d - b * c;
        var invdet = 1.0 / det;
        var x = u * d - b * v;
        var y = -u * c + a * v;
        x *= invdet;
        y *= invdet;
        return [x, y];
    };

    // # class Vector3D
    // Represents a 3D vector.
    //
    // Example usage:
    //
    //     new CSG.Vector3D(1, 2, 3);
    //     new CSG.Vector3D([1, 2, 3]);
    //     new CSG.Vector3D({ x: 1, y: 2, z: 3 });
    //     new CSG.Vector3D(1, 2); // assumes z=0
    //     new CSG.Vector3D([1, 2]); // assumes z=0
    CSG.Vector3D = function(x, y, z) {
        if (arguments.length == 3) {
            this._x = parseFloat(x);
            this._y = parseFloat(y);
            this._z = parseFloat(z);
        } else if (arguments.length == 2) {
            this._x = parseFloat(x);
            this._y = parseFloat(y);
            this._z = 0;
        } else {
            var ok = true;
            if (arguments.length == 1) {
                if (typeof(x) == "object") {
                    if (x instanceof CSG.Vector3D) {
                        this._x = x._x;
                        this._y = x._y;
                        this._z = x._z;
                    } else if (x instanceof CSG.Vector2D) {
                        this._x = x._x;
                        this._y = x._y;
                        this._z = 0;
                    } else if (x instanceof Array) {
                        if ((x.length < 2) || (x.length > 3)) {
                            ok = false;
                        } else {
                            this._x = parseFloat(x[0]);
                            this._y = parseFloat(x[1]);
                            if (x.length == 3) {
                                this._z = parseFloat(x[2]);
                            } else {
                                this._z = 0;
                            }
                        }
                    } else if (('_x' in x) && ('_y' in x)) {
                        this._x = parseFloat(x._x);
                        this._y = parseFloat(x._y);
                        if ('_z' in x) {
                            this._z = parseFloat(x._z);
                        } else {
                            this._z = 0;
                        }
                    } else ok = false;
                } else {
                    var v = parseFloat(x);
                    this._x = v;
                    this._y = v;
                    this._z = v;
                }
            } else ok = false;
            if (ok) {
                if ((!CSG.IsFloat(this._x)) || (!CSG.IsFloat(this._y)) || (!CSG.IsFloat(this._z))) ok = false;
            }
            if (!ok) {
                throw new Error("wrong arguments");
            }
        }
    };

    // This does the same as new CSG.Vector3D(x,y,z) but it doesn't go through the constructor
    // and the parameters are not validated. Is much faster.
    CSG.Vector3D.Create = function(x, y, z) {
        var result = Object.create(CSG.Vector3D.prototype);
        result._x = x;
        result._y = y;
        result._z = z;
        return result;
    };

    CSG.Vector3D.prototype = {
        get x() {
            return this._x;
        },
        get y() {
            return this._y;
        },
        get z() {
            return this._z;
        },

        set x(v) {
            throw new Error("Vector3D is immutable");
        },
        set y(v) {
            throw new Error("Vector3D is immutable");
        },
        set z(v) {
            throw new Error("Vector3D is immutable");
        },

        clone: function() {
            return CSG.Vector3D.Create(this._x, this._y, this._z);
        },

        negated: function() {
            return CSG.Vector3D.Create(-this._x, -this._y, -this._z);
        },

        abs: function() {
            return CSG.Vector3D.Create(Math.abs(this._x), Math.abs(this._y), Math.abs(this._z));
        },

        plus: function(a) {
            return CSG.Vector3D.Create(this._x + a._x, this._y + a._y, this._z + a._z);
        },

        minus: function(a) {
            return CSG.Vector3D.Create(this._x - a._x, this._y - a._y, this._z - a._z);
        },

        times: function(a) {
            return CSG.Vector3D.Create(this._x * a, this._y * a, this._z * a);
        },

        dividedBy: function(a) {
            return CSG.Vector3D.Create(this._x / a, this._y / a, this._z / a);
        },

        dot: function(a) {
            return this._x * a._x + this._y * a._y + this._z * a._z;
        },

        lerp: function(a, t) {
            return this.plus(a.minus(this).times(t));
        },

        lengthSquared: function() {
            return this.dot(this);
        },

        length: function() {
            return Math.sqrt(this.lengthSquared());
        },

        unit: function() {
            return this.dividedBy(this.length());
        },

        cross: function(a) {
            return CSG.Vector3D.Create(
                this._y * a._z - this._z * a._y, this._z * a._x - this._x * a._z, this._x * a._y - this._y * a._x);
        },

        distanceTo: function(a) {
            return this.minus(a).length();
        },

        distanceToSquared: function(a) {
            return this.minus(a).lengthSquared();
        },

        equals: function(a) {
            return (this._x == a._x) && (this._y == a._y) && (this._z == a._z);
        },

        // Right multiply by a 4x4 matrix (the vector is interpreted as a row vector)
        // Returns a new CSG.Vector3D
        multiply4x4: function(matrix4x4) {
            return matrix4x4.leftMultiply1x3Vector(this);
        },

        transform: function(matrix4x4) {
            return matrix4x4.leftMultiply1x3Vector(this);
        },

        toString: function() {
            return "(" + this._x.toFixed(2) + ", " + this._y.toFixed(2) + ", " + this._z.toFixed(2) + ")";
        },

        // find a vector that is somewhat perpendicular to this one
        randomNonParallelVector: function() {
            var abs = this.abs();
            if ((abs._x <= abs._y) && (abs._x <= abs._z)) {
                return CSG.Vector3D.Create(1, 0, 0);
            } else if ((abs._y <= abs._x) && (abs._y <= abs._z)) {
                return CSG.Vector3D.Create(0, 1, 0);
            } else {
                return CSG.Vector3D.Create(0, 0, 1);
            }
        },

        min: function(p) {
            return CSG.Vector3D.Create(
                Math.min(this._x, p._x), Math.min(this._y, p._y), Math.min(this._z, p._z));
        },

        max: function(p) {
            return CSG.Vector3D.Create(
                Math.max(this._x, p._x), Math.max(this._y, p._y), Math.max(this._z, p._z));
        }
    };

    // # class Vertex
    // Represents a vertex of a polygon. Use your own vertex class instead of this
    // one to provide additional features like texture coordinates and vertex
    // colors. Custom vertex classes need to provide a `pos` property
    // `flipped()`, and `interpolate()` methods that behave analogous to the ones
    // defined by `CSG.Vertex`.
    CSG.Vertex = function(pos) {
        this.pos = pos;
    };

    // create from an untyped object with identical property names:
    CSG.Vertex.fromObject = function(obj) {
        var pos = new CSG.Vector3D(obj.pos);
        return new CSG.Vertex(pos);
    };

    CSG.Vertex.prototype = {
        // Return a vertex with all orientation-specific data (e.g. vertex normal) flipped. Called when the
        // orientation of a polygon is flipped.
        flipped: function() {
            return this;
        },

        getTag: function() {
            var result = this.tag;
            if (!result) {
                result = CSG.getTag();
                this.tag = result;
            }
            return result;
        },

        // Create a new vertex between this vertex and `other` by linearly
        // interpolating all properties using a parameter of `t`. Subclasses should
        // override this to interpolate additional properties.
        interpolate: function(other, t) {
            var newpos = this.pos.lerp(other.pos, t);
            return new CSG.Vertex(newpos);
        },

        // Affine transformation of vertex. Returns a new CSG.Vertex
        transform: function(matrix4x4) {
            var newpos = this.pos.multiply4x4(matrix4x4);
            return new CSG.Vertex(newpos);
        },

        toString: function() {
            return this.pos.toString();
        }
    };

    // # class Plane
    // Represents a plane in 3D space.
    CSG.Plane = function(normal, w) {
        this.normal = normal;
        this.w = w;
    };

    // create from an untyped object with identical property names:
    CSG.Plane.fromObject = function(obj) {
        var normal = new CSG.Vector3D(obj.normal);
        var w = parseFloat(obj.w);
        return new CSG.Plane(normal, w);
    };

    // `CSG.Plane.EPSILON` is the tolerance used by `splitPolygon()` to decide if a
    // point is on the plane.
    CSG.Plane.EPSILON = 1e-5;

    CSG.Plane.fromVector3Ds = function(a, b, c) {
        var n = b.minus(a).cross(c.minus(a)).unit();
        return new CSG.Plane(n, n.dot(a));
    };

    // like fromVector3Ds, but allow the vectors to be on one point or one line
    // in such a case a random plane through the given points is constructed
    CSG.Plane.anyPlaneFromVector3Ds = function(a, b, c) {
        var v1 = b.minus(a);
        var v2 = c.minus(a);
        if (v1.length() < 1e-5) {
            v1 = v2.randomNonParallelVector();
        }
        if (v2.length() < 1e-5) {
            v2 = v1.randomNonParallelVector();
        }
        var normal = v1.cross(v2);
        if (normal.length() < 1e-5) {
            // this would mean that v1 == v2.negated()
            v2 = v1.randomNonParallelVector();
            normal = v1.cross(v2);
        }
        normal = normal.unit();
        return new CSG.Plane(normal, normal.dot(a));
    };

    CSG.Plane.fromPoints = function(a, b, c) {
        a = new CSG.Vector3D(a);
        b = new CSG.Vector3D(b);
        c = new CSG.Vector3D(c);
        return CSG.Plane.fromVector3Ds(a, b, c);
    };

    CSG.Plane.fromNormalAndPoint = function(normal, point) {
        normal = new CSG.Vector3D(normal);
        point = new CSG.Vector3D(point);
        normal = normal.unit();
        var w = point.dot(normal);
        return new CSG.Plane(normal, w);
    };

    CSG.Plane.prototype = {
        flipped: function() {
            return new CSG.Plane(this.normal.negated(), -this.w);
        },

        getTag: function() {
            var result = this.tag;
            if (!result) {
                result = CSG.getTag();
                this.tag = result;
            }
            return result;
        },

        equals: function(n) {
            return this.normal.equals(n.normal) && this.w == n.w;
        },

        transform: function(matrix4x4) {
            var ismirror = matrix4x4.isMirroring();
            // get two vectors in the plane:
            var r = this.normal.randomNonParallelVector();
            var u = this.normal.cross(r);
            var v = this.normal.cross(u);
            // get 3 points in the plane:
            var point1 = this.normal.times(this.w);
            var point2 = point1.plus(u);
            var point3 = point1.plus(v);
            // transform the points:
            point1 = point1.multiply4x4(matrix4x4);
            point2 = point2.multiply4x4(matrix4x4);
            point3 = point3.multiply4x4(matrix4x4);
            // and create a new plane from the transformed points:
            var newplane = CSG.Plane.fromVector3Ds(point1, point2, point3);
            if (ismirror) {
                // the transform is mirroring
                // We should mirror the plane:
                newplane = newplane.flipped();
            }
            return newplane;
        },

        // Returns object:
        // .type:
        //   0: coplanar-front
        //   1: coplanar-back
        //   2: front
        //   3: back
        //   4: spanning
        // In case the polygon is spanning, returns:
        // .front: a CSG.Polygon of the front part
        // .back: a CSG.Polygon of the back part
        splitPolygon: function(polygon) {
            var result = {
                type: null,
                front: null,
                back: null
            };
            // cache in local vars (speedup):
            var planenormal = this.normal;
            var vertices = polygon.vertices;
            var numvertices = vertices.length;
            if (polygon.plane.equals(this)) {
                result.type = 0;
            } else {
                var EPS = CSG.Plane.EPSILON;
                var thisw = this.w;
                var hasfront = false;
                var hasback = false;
                var vertexIsBack = [];
                var MINEPS = -EPS;
                for (var i = 0; i < numvertices; i++) {
                    var t = planenormal.dot(vertices[i].pos) - thisw;
                    var isback = (t < 0);
                    vertexIsBack.push(isback);
                    if (t > EPS) hasfront = true;
                    if (t < MINEPS) hasback = true;
                }
                if ((!hasfront) && (!hasback)) {
                    // all points coplanar
                    var t = planenormal.dot(polygon.plane.normal);
                    result.type = (t >= 0) ? 0 : 1;
                } else if (!hasback) {
                    result.type = 2;
                } else if (!hasfront) {
                    result.type = 3;
                } else {
                    // spanning
                    result.type = 4;
                    var frontvertices = [],
                        backvertices = [];
                    var isback = vertexIsBack[0];
                    for (var vertexindex = 0; vertexindex < numvertices; vertexindex++) {
                        var vertex = vertices[vertexindex];
                        var nextvertexindex = vertexindex + 1;
                        if (nextvertexindex >= numvertices) nextvertexindex = 0;
                        var nextisback = vertexIsBack[nextvertexindex];
                        if (isback == nextisback) {
                            // line segment is on one side of the plane:
                            if (isback) {
                                backvertices.push(vertex);
                            } else {
                                frontvertices.push(vertex);
                            }
                        } else {
                            // line segment intersects plane:
                            var point = vertex.pos;
                            var nextpoint = vertices[nextvertexindex].pos;
                            var intersectionpoint = this.splitLineBetweenPoints(point, nextpoint);
                            var intersectionvertex = new CSG.Vertex(intersectionpoint);
                            if (isback) {
                                backvertices.push(vertex);
                                backvertices.push(intersectionvertex);
                                frontvertices.push(intersectionvertex);
                            } else {
                                frontvertices.push(vertex);
                                frontvertices.push(intersectionvertex);
                                backvertices.push(intersectionvertex);
                            }
                        }
                        isback = nextisback;
                    } // for vertexindex
                    // remove duplicate vertices:
                    var EPS_SQUARED = CSG.Plane.EPSILON * CSG.Plane.EPSILON;
                    if (backvertices.length >= 3) {
                        var prevvertex = backvertices[backvertices.length - 1];
                        for (var vertexindex = 0; vertexindex < backvertices.length; vertexindex++) {
                            var vertex = backvertices[vertexindex];
                            if (vertex.pos.distanceToSquared(prevvertex.pos) < EPS_SQUARED) {
                                backvertices.splice(vertexindex, 1);
                                vertexindex--;
                            }
                            prevvertex = vertex;
                        }
                    }
                    if (frontvertices.length >= 3) {
                        var prevvertex = frontvertices[frontvertices.length - 1];
                        for (var vertexindex = 0; vertexindex < frontvertices.length; vertexindex++) {
                            var vertex = frontvertices[vertexindex];
                            if (vertex.pos.distanceToSquared(prevvertex.pos) < EPS_SQUARED) {
                                frontvertices.splice(vertexindex, 1);
                                vertexindex--;
                            }
                            prevvertex = vertex;
                        }
                    }
                    if (frontvertices.length >= 3) {
                        result.front = new CSG.Polygon(frontvertices, polygon.shared, polygon.plane);
                    }
                    if (backvertices.length >= 3) {
                        result.back = new CSG.Polygon(backvertices, polygon.shared, polygon.plane);
                    }
                }
            }
            return result;
        },

        // robust splitting of a line by a plane
        // will work even if the line is parallel to the plane
        splitLineBetweenPoints: function(p1, p2) {
            var direction = p2.minus(p1);
            var labda = (this.w - this.normal.dot(p1)) / this.normal.dot(direction);
            if (isNaN(labda)) labda = 0;
            if (labda > 1) labda = 1;
            if (labda < 0) labda = 0;
            var result = p1.plus(direction.times(labda));
            return result;
        },

        // returns CSG.Vector3D
        intersectWithLine: function(line3d) {
            return line3d.intersectWithPlane(this);
        },

        // intersection of two planes
        intersectWithPlane: function(plane) {
            return CSG.Line3D.fromPlanes(this, plane);
        },

        signedDistanceToPoint: function(point) {
            var t = this.normal.dot(point) - this.w;
            return t;
        },

        toString: function() {
            return "[normal: " + this.normal.toString() + ", w: " + this.w + "]";
        },

        mirrorPoint: function(point3d) {
            var distance = this.signedDistanceToPoint(point3d);
            var mirrored = point3d.minus(this.normal.times(distance * 2.0));
            return mirrored;
        }
    };


    // # class Polygon
    // Represents a convex polygon. The vertices used to initialize a polygon must
    // be coplanar and form a convex loop. They do not have to be `CSG.Vertex`
    // instances but they must behave similarly (duck typing can be used for
    // customization).
    //
    // Each convex polygon has a `shared` property, which is shared between all
    // polygons that are clones of each other or were split from the same polygon.
    // This can be used to define per-polygon properties (such as surface color).
    //
    // The plane of the polygon is calculated from the vertex coordinates
    // To avoid unnecessary recalculation, the plane can alternatively be
    // passed as the third argument
    CSG.Polygon = function(vertices, shared, plane) {
        this.vertices = vertices;
        if (!shared) shared = CSG.Polygon.defaultShared;
        this.shared = shared;
        //var numvertices = vertices.length;

        if (arguments.length >= 3) {
            this.plane = plane;
        } else {
            this.plane = CSG.Plane.fromVector3Ds(vertices[0].pos, vertices[1].pos, vertices[2].pos);
        }

        if (_CSGDEBUG) {
            this.checkIfConvex();
        }
    };

    // create from an untyped object with identical property names:
    CSG.Polygon.fromObject = function(obj) {
        var vertices = obj.vertices.map(function(v) {
            return CSG.Vertex.fromObject(v);
        });
        var shared = CSG.Polygon.Shared.fromObject(obj.shared);
        var plane = CSG.Plane.fromObject(obj.plane);
        return new CSG.Polygon(vertices, shared, plane);
    };

    CSG.Polygon.prototype = {
        // check whether the polygon is convex (it should be, otherwise we will get unexpected results)
        checkIfConvex: function() {
            if (!CSG.Polygon.verticesConvex(this.vertices, this.plane.normal)) {
                CSG.Polygon.verticesConvex(this.vertices, this.plane.normal);
                throw new Error("Not convex!");
            }
        },

        setColor: function(args) {
            var newshared = CSG.Polygon.Shared.fromColor.apply(this, arguments);
            this.shared = newshared;
            return this;
        },

        getSignedVolume: function() {
            var signedVolume = 0;
            for (var i = 0; i < this.vertices.length - 2; i++) {
                signedVolume += this.vertices[0].pos.dot(this.vertices[i+1].pos
                    .cross(this.vertices[i+2].pos));
            }
            signedVolume /= 6;
            return signedVolume;
        },

        // Note: could calculate vectors only once to speed up
        getArea: function() {
            var polygonArea = 0;
            for (var i = 0; i < this.vertices.length - 2; i++) {
                polygonArea += this.vertices[i+1].pos.minus(this.vertices[0].pos)
                    .cross(this.vertices[i+2].pos.minus(this.vertices[i+1].pos)).length();
            }
            polygonArea /= 2;
            return polygonArea;
        },


        // accepts array of features to calculate
        // returns array of results
        getTetraFeatures: function(features) {
            var result = [];
            features.forEach(function(feature) {
                if (feature == 'volume') {
                    result.push(this.getSignedVolume());
                } else if (feature == 'area') {
                    result.push(this.getArea());
                }
            }, this);
            return result;
        },

        // Extrude a polygon into the direction offsetvector
        // Returns a CSG object
        extrude: function(offsetvector) {
            var newpolygons = [];

            var polygon1 = this;
            var direction = polygon1.plane.normal.dot(offsetvector);
            if (direction > 0) {
                polygon1 = polygon1.flipped();
            }
            newpolygons.push(polygon1);
            var polygon2 = polygon1.translate(offsetvector);
            var numvertices = this.vertices.length;
            for (var i = 0; i < numvertices; i++) {
                var sidefacepoints = [];
                var nexti = (i < (numvertices - 1)) ? i + 1 : 0;
                sidefacepoints.push(polygon1.vertices[i].pos);
                sidefacepoints.push(polygon2.vertices[i].pos);
                sidefacepoints.push(polygon2.vertices[nexti].pos);
                sidefacepoints.push(polygon1.vertices[nexti].pos);
                var sidefacepolygon = CSG.Polygon.createFromPoints(sidefacepoints, this.shared);
                newpolygons.push(sidefacepolygon);
            }
            polygon2 = polygon2.flipped();
            newpolygons.push(polygon2);
            return CSG.fromPolygons(newpolygons);
        },

        translate: function(offset) {
            return this.transform(CSG.Matrix4x4.translation(offset));
        },

        // returns an array with a CSG.Vector3D (center point) and a radius
        boundingSphere: function() {
            if (!this.cachedBoundingSphere) {
                var box = this.boundingBox();
                var middle = box[0].plus(box[1]).times(0.5);
                var radius3 = box[1].minus(middle);
                var radius = radius3.length();
                this.cachedBoundingSphere = [middle, radius];
            }
            return this.cachedBoundingSphere;
        },

        // returns an array of two CSG.Vector3Ds (minimum coordinates and maximum coordinates)
        boundingBox: function() {
            if (!this.cachedBoundingBox) {
                var minpoint, maxpoint;
                var vertices = this.vertices;
                var numvertices = vertices.length;
                if (numvertices === 0) {
                    minpoint = new CSG.Vector3D(0, 0, 0);
                } else {
                    minpoint = vertices[0].pos;
                }
                maxpoint = minpoint;
                for (var i = 1; i < numvertices; i++) {
                    var point = vertices[i].pos;
                    minpoint = minpoint.min(point);
                    maxpoint = maxpoint.max(point);
                }
                this.cachedBoundingBox = [minpoint, maxpoint];
            }
            return this.cachedBoundingBox;
        },

        flipped: function() {
            var newvertices = this.vertices.map(function(v) {
                return v.flipped();
            });
            newvertices.reverse();
            var newplane = this.plane.flipped();
            return new CSG.Polygon(newvertices, this.shared, newplane);
        },

        // Affine transformation of polygon. Returns a new CSG.Polygon
        transform: function(matrix4x4) {
            var newvertices = this.vertices.map(function(v) {
                return v.transform(matrix4x4);
            });
            var newplane = this.plane.transform(matrix4x4);
            if (matrix4x4.isMirroring()) {
                // need to reverse the vertex order
                // in order to preserve the inside/outside orientation:
                newvertices.reverse();
            }
            return new CSG.Polygon(newvertices, this.shared, newplane);
        },

        toString: function() {
            var result = "Polygon plane: " + this.plane.toString() + "\n";
            this.vertices.map(function(vertex) {
                result += "  " + vertex.toString() + "\n";
            });
            return result;
        },

        // project the 3D polygon onto a plane
        projectToOrthoNormalBasis: function(orthobasis) {
            var points2d = this.vertices.map(function(vertex) {
                return orthobasis.to2D(vertex.pos);
            });
            var result = CAG.fromPointsNoCheck(points2d);
            var area = result.area();
            if (Math.abs(area) < 1e-5) {
                // the polygon was perpendicular to the orthnormal plane. The resulting 2D polygon would be degenerate
                // return an empty area instead:
                result = new CAG();
            } else if (area < 0) {
                result = result.flipped();
            }
            return result;
        },

        /**
         * Creates solid from slices (CSG.Polygon) by generating walls
         * @param {Object} options Solid generating options
         *  - numslices {Number} Number of slices to be generated
         *  - callback(t, slice) {Function} Callback function generating slices.
         *          arguments: t = [0..1], slice = [0..numslices - 1]
         *          return: CSG.Polygon or null to skip
         *  - loop {Boolean} no flats, only walls, it's used to generate solids like a tor
         */
        solidFromSlices: function(options) {
            var polygons = [],
                csg = null,
                prev = null,
                bottom = null,
                top = null,
                numSlices = 2,
                bLoop = false,
                fnCallback,
                flipped = null;

            if (options) {
                bLoop = Boolean(options['loop']);

                if (options.numslices)
                    numSlices = options.numslices;

                if (options.callback)
                    fnCallback = options.callback;
            }
            if (!fnCallback) {
                var square = new CSG.Polygon.createFromPoints([
                    [0, 0, 0],
                    [1, 0, 0],
                    [1, 1, 0],
                    [0, 1, 0]
                ]);
                fnCallback = function(t, slice) {
                    return t == 0 || t == 1 ? square.translate([0, 0, t]) : null;
                }
            }
            for (var i = 0, iMax = numSlices - 1; i <= iMax; i++) {
                csg = fnCallback.call(this, i / iMax, i);
                if (csg) {
                    if (!(csg instanceof CSG.Polygon)) {
                        throw new Error("CSG.Polygon.solidFromSlices callback error: CSG.Polygon expected");
                    }
                    csg.checkIfConvex();

                    if (prev) { //generate walls
                        if (flipped === null) { //not generated yet
                            flipped = prev.plane.signedDistanceToPoint(csg.vertices[0].pos) < 0;
                        }
                        this._addWalls(polygons, prev, csg, flipped);

                    } else { //the first - will be a bottom
                        bottom = csg;
                    }
                    prev = csg;
                } //callback can return null to skip that slice
            }
            top = csg;

            if (bLoop) {
                var bSameTopBottom = bottom.vertices.length == top.vertices.length &&
                    bottom.vertices.every(function(v, index) {
                        return v.pos.equals(top.vertices[index].pos)
                    });
                //if top and bottom are not the same -
                //generate walls between them
                if (!bSameTopBottom) {
                    this._addWalls(polygons, top, bottom, flipped);
                } //else - already generated
            } else {
                //save top and bottom
                //TODO: flip if necessary
                polygons.unshift(flipped ? bottom : bottom.flipped());
                polygons.push(flipped ? top.flipped() : top);
            }
            return CSG.fromPolygons(polygons);
        },
        /**
         *
         * @param walls Array of wall polygons
         * @param bottom Bottom polygon
         * @param top Top polygon
         */
        _addWalls: function(walls, bottom, top, bFlipped) {
            var bottomPoints = bottom.vertices.slice(0), //make a copy
                topPoints = top.vertices.slice(0), //make a copy
                color = top.shared || null;

            //check if bottom perimeter is closed
            if (!bottomPoints[0].pos.equals(bottomPoints[bottomPoints.length - 1].pos)) {
                bottomPoints.push(bottomPoints[0]);
            }

            //check if top perimeter is closed
            if (!topPoints[0].pos.equals(topPoints[topPoints.length - 1].pos)) {
                topPoints.push(topPoints[0]);
            }
            if (bFlipped) {
                bottomPoints = bottomPoints.reverse();
                topPoints = topPoints.reverse();
            }

            var iTopLen = topPoints.length - 1,
                iBotLen = bottomPoints.length - 1,
                iExtra = iTopLen - iBotLen, //how many extra triangles we need
                bMoreTops = iExtra > 0,
                bMoreBottoms = iExtra < 0;

            var aMin = []; //indexes to start extra triangles (polygon with minimal square)
            //init - we need exactly /iExtra/ small triangles
            for (var i = Math.abs(iExtra); i > 0; i--) {
                aMin.push({
                    len: Infinity,
                    index: -1
                });
            }

            var len;
            if (bMoreBottoms) {
                for (var i = 0; i < iBotLen; i++) {
                    len = bottomPoints[i].pos.distanceToSquared(bottomPoints[i + 1].pos);
                    //find the element to replace
                    for (var j = aMin.length - 1; j >= 0; j--) {
                        if (aMin[j].len > len) {
                            aMin[j].len = len;
                            aMin.index = j;
                            break;
                        }
                    } //for
                }
            } else if (bMoreTops) {
                for (var i = 0; i < iTopLen; i++) {
                    len = topPoints[i].pos.distanceToSquared(topPoints[i + 1].pos);
                    //find the element to replace
                    for (var j = aMin.length - 1; j >= 0; j--) {
                        if (aMin[j].len > len) {
                            aMin[j].len = len;
                            aMin.index = j;
                            break;
                        }
                    } //for
                }
            } //if
            //sort by index
            aMin.sort(fnSortByIndex);
            var getTriangle = function addWallsPutTriangle(pointA, pointB, pointC, color) {
                return new CSG.Polygon([pointA, pointB, pointC], color);
                //return bFlipped ? triangle.flipped() : triangle;
            };

            var bpoint = bottomPoints[0],
                tpoint = topPoints[0],
                secondPoint,
                nBotFacet, nTopFacet; //length of triangle facet side
            for (var iB = 0, iT = 0, iMax = iTopLen + iBotLen; iB + iT < iMax;) {
                if (aMin.length) {
                    if (bMoreTops && iT == aMin[0].index) { //one vertex is on the bottom, 2 - on the top
                        secondPoint = topPoints[++iT];
                        //console.log('<<< extra top: ' + secondPoint + ', ' + tpoint + ', bottom: ' + bpoint);
                        walls.push(getTriangle(
                            secondPoint, tpoint, bpoint, color
                        ));
                        tpoint = secondPoint;
                        aMin.shift();
                        continue;
                    } else if (bMoreBottoms && iB == aMin[0].index) {
                        secondPoint = bottomPoints[++iB];
                        walls.push(getTriangle(
                            tpoint, bpoint, secondPoint, color
                        ));
                        bpoint = secondPoint;
                        aMin.shift();
                        continue;
                    }
                }
                //choose the shortest path
                if (iB < iBotLen) { //one vertex is on the top, 2 - on the bottom
                    nBotFacet = tpoint.pos.distanceToSquared(bottomPoints[iB + 1].pos);
                } else {
                    nBotFacet = Infinity;
                }
                if (iT < iTopLen) { //one vertex is on the bottom, 2 - on the top
                    nTopFacet = bpoint.pos.distanceToSquared(topPoints[iT + 1].pos);
                } else {
                    nTopFacet = Infinity;
                }
                if (nBotFacet <= nTopFacet) {
                    secondPoint = bottomPoints[++iB];
                    walls.push(getTriangle(
                        tpoint, bpoint, secondPoint, color
                    ));
                    bpoint = secondPoint;
                } else if (iT < iTopLen) { //nTopFacet < Infinity
                    secondPoint = topPoints[++iT];
                    //console.log('<<< top: ' + secondPoint + ', ' + tpoint + ', bottom: ' + bpoint);
                    walls.push(getTriangle(
                        secondPoint, tpoint, bpoint, color
                    ));
                    tpoint = secondPoint;
                };
            }
            return walls;
        }
    };

    CSG.Polygon.verticesConvex = function(vertices, planenormal) {
        var numvertices = vertices.length;
        if (numvertices > 2) {
            var prevprevpos = vertices[numvertices - 2].pos;
            var prevpos = vertices[numvertices - 1].pos;
            for (var i = 0; i < numvertices; i++) {
                var pos = vertices[i].pos;
                if (!CSG.Polygon.isConvexPoint(prevprevpos, prevpos, pos, planenormal)) {
                    return false;
                }
                prevprevpos = prevpos;
                prevpos = pos;
            }
        }
        return true;
    };

    // Create a polygon from the given points
    CSG.Polygon.createFromPoints = function(points, shared, plane) {
        var normal;
        if (arguments.length < 3) {
            // initially set a dummy vertex normal:
            normal = new CSG.Vector3D(0, 0, 0);
        } else {
            normal = plane.normal;
        }
        var vertices = [];
        points.map(function(p) {
            var vec = new CSG.Vector3D(p);
            var vertex = new CSG.Vertex(vec);
            vertices.push(vertex);
        });
        var polygon;
        if (arguments.length < 3) {
            polygon = new CSG.Polygon(vertices, shared);
        } else {
            polygon = new CSG.Polygon(vertices, shared, plane);
        }
        return polygon;
    };

    // calculate whether three points form a convex corner
    //  prevpoint, point, nextpoint: the 3 coordinates (CSG.Vector3D instances)
    //  normal: the normal vector of the plane
    CSG.Polygon.isConvexPoint = function(prevpoint, point, nextpoint, normal) {
        var crossproduct = point.minus(prevpoint).cross(nextpoint.minus(point));
        var crossdotnormal = crossproduct.dot(normal);
        return (crossdotnormal >= 0);
    };

    CSG.Polygon.isStrictlyConvexPoint = function(prevpoint, point, nextpoint, normal) {
        var crossproduct = point.minus(prevpoint).cross(nextpoint.minus(point));
        var crossdotnormal = crossproduct.dot(normal);
        return (crossdotnormal >= 1e-5);
    };

    // # class CSG.Polygon.Shared
    // Holds the shared properties for each polygon (currently only color)
    // Constructor expects a 4 element array [r,g,b,a], values from 0 to 1, or null
    CSG.Polygon.Shared = function(color) {
        if(color !== null)
        {
            if (color.length != 4) {
                throw new Error("Expecting 4 element array");
            }
        }
        this.color = color;
    };

    CSG.Polygon.Shared.fromObject = function(obj) {
        return new CSG.Polygon.Shared(obj.color);
    };

    // Create CSG.Polygon.Shared from a color, can be called as follows:
    // var s = CSG.Polygon.Shared.fromColor(r,g,b [,a])
    // var s = CSG.Polygon.Shared.fromColor([r,g,b [,a]])
    CSG.Polygon.Shared.fromColor = function(args) {
        var color;
        if(arguments.length == 1) {
            color = arguments[0].slice(); // make deep copy
        }
        else {
            color = [];
            for(var i=0; i < arguments.length; i++) {
                color.push(arguments[i]);
            }
        }
        if(color.length == 3) {
            color.push(1);
        } else if(color.length != 4) {
            throw new Error("setColor expects either an array with 3 or 4 elements, or 3 or 4 parameters.");
        }
        return new CSG.Polygon.Shared(color);
    };

    CSG.Polygon.Shared.prototype = {
        getTag: function() {
            var result = this.tag;
            if (!result) {
                result = CSG.getTag();
                this.tag = result;
            }
            return result;
        },
        // get a string uniquely identifying this object
        getHash: function() {
            if (!this.color) return "null";
            return this.color.join("/");
        }
    };

    CSG.Polygon.defaultShared = new CSG.Polygon.Shared(null);

    // # class PolygonTreeNode
    // This class manages hierarchical splits of polygons
    // At the top is a root node which doesn hold a polygon, only child PolygonTreeNodes
    // Below that are zero or more 'top' nodes; each holds a polygon. The polygons can be in different planes
    // splitByPlane() splits a node by a plane. If the plane intersects the polygon, two new child nodes
    // are created holding the splitted polygon.
    // getPolygons() retrieves the polygon from the tree. If for PolygonTreeNode the polygon is split but
    // the two split parts (child nodes) are still intact, then the unsplit polygon is returned.
    // This ensures that we can safely split a polygon into many fragments. If the fragments are untouched,
    //  getPolygons() will return the original unsplit polygon instead of the fragments.
    // remove() removes a polygon from the tree. Once a polygon is removed, the parent polygons are invalidated
    // since they are no longer intact.
    // constructor creates the root node:
    CSG.PolygonTreeNode = function() {
        this.parent = null;
        this.children = [];
        this.polygon = null;
        this.removed = false;
    };

    CSG.PolygonTreeNode.prototype = {
        // fill the tree with polygons. Should be called on the root node only; child nodes must
        // always be a derivate (split) of the parent node.
        addPolygons: function(polygons) {
            if (!this.isRootNode())
            // new polygons can only be added to root node; children can only be splitted polygons
                throw new Error("Assertion failed");
            var _this = this;
            polygons.map(function(polygon) {
                _this.addChild(polygon);
            });
        },

        // remove a node
        // - the siblings become toplevel nodes
        // - the parent is removed recursively
        remove: function() {
            if (!this.removed) {
                this.removed = true;

                if (_CSGDEBUG) {
                    if (this.isRootNode()) throw new Error("Assertion failed"); // can't remove root node
                    if (this.children.length) throw new Error("Assertion failed"); // we shouldn't remove nodes with children
                }

                // remove ourselves from the parent's children list:
                var parentschildren = this.parent.children;
                var i = parentschildren.indexOf(this);
                if (i < 0) throw new Error("Assertion failed");
                parentschildren.splice(i, 1);

                // invalidate the parent's polygon, and of all parents above it:
                this.parent.recursivelyInvalidatePolygon();
            }
        },

        isRemoved: function() {
            return this.removed;
        },

        isRootNode: function() {
            return !this.parent;
        },

        // invert all polygons in the tree. Call on the root node
        invert: function() {
            if (!this.isRootNode()) throw new Error("Assertion failed"); // can only call this on the root node
            this.invertSub();
        },

        getPolygon: function() {
            if (!this.polygon) throw new Error("Assertion failed"); // doesn't have a polygon, which means that it has been broken down
            return this.polygon;
        },

        getPolygons: function(result) {
            var children = [this];
            var queue = [children];
            var i, j, l, node;
            for (i = 0; i < queue.length; ++i ) { // queue size can change in loop, don't cache length
                children = queue[i];
                for (j = 0, l = children.length; j < l; j++) { // ok to cache length
                    node = children[j];
                    if (node.polygon) {
                        // the polygon hasn't been broken yet. We can ignore the children and return our polygon:
                        result.push(node.polygon);
                    } else {
                        // our polygon has been split up and broken, so gather all subpolygons from the children
                        queue.push(node.children);
                    }
                }
            }
        },

        // split the node by a plane; add the resulting nodes to the frontnodes and backnodes array
        // If the plane doesn't intersect the polygon, the 'this' object is added to one of the arrays
        // If the plane does intersect the polygon, two new child nodes are created for the front and back fragments,
        //  and added to both arrays.
        splitByPlane: function(plane, coplanarfrontnodes, coplanarbacknodes, frontnodes, backnodes) {
            if (this.children.length) {
                var queue = [this.children], i, j, l, node, nodes;
                for (i = 0; i < queue.length; i++) { // queue.length can increase, do not cache
                    nodes = queue[i];
                    for (j = 0, l = nodes.length; j < l; j++) { // ok to cache length
                        node = nodes[j];
                        if (node.children.length) {
                            queue.push(node.children);
                        } else {
                            // no children. Split the polygon:
                            node._splitByPlane(plane, coplanarfrontnodes, coplanarbacknodes, frontnodes, backnodes);
                        }
                    }
                }
            } else {
                this._splitByPlane(plane, coplanarfrontnodes, coplanarbacknodes, frontnodes, backnodes);
            }
        },

        // only to be called for nodes with no children
        _splitByPlane: function (plane, coplanarfrontnodes, coplanarbacknodes, frontnodes, backnodes) {
            var polygon = this.polygon;
            if (polygon) {
                var bound = polygon.boundingSphere();
                var sphereradius = bound[1] + 1e-4;
                var planenormal = plane.normal;
                var spherecenter = bound[0];
                var d = planenormal.dot(spherecenter) - plane.w;
                if (d > sphereradius) {
                    frontnodes.push(this);
                } else if (d < -sphereradius) {
                    backnodes.push(this);
                } else {
                    var splitresult = plane.splitPolygon(polygon);
                    switch (splitresult.type) {
                        case 0:
                            // coplanar front:
                            coplanarfrontnodes.push(this);
                            break;

                        case 1:
                            // coplanar back:
                            coplanarbacknodes.push(this);
                            break;

                        case 2:
                            // front:
                            frontnodes.push(this);
                            break;

                        case 3:
                            // back:
                            backnodes.push(this);
                            break;

                        case 4:
                            // spanning:
                            if (splitresult.front) {
                                var frontnode = this.addChild(splitresult.front);
                                frontnodes.push(frontnode);
                            }
                            if (splitresult.back) {
                                var backnode = this.addChild(splitresult.back);
                                backnodes.push(backnode);
                            }
                            break;
                    }
                }
            }
        },


        // PRIVATE methods from here:
        // add child to a node
        // this should be called whenever the polygon is split
        // a child should be created for every fragment of the split polygon
        // returns the newly created child
        addChild: function(polygon) {
            var newchild = new CSG.PolygonTreeNode();
            newchild.parent = this;
            newchild.polygon = polygon;
            this.children.push(newchild);
            return newchild;
        },

        invertSub: function() {
            var children = [this];
            var queue = [children];
            var i, j, l, node;
            for (i = 0; i < queue.length; i++) {
                children = queue[i];
                for (j = 0, l = children.length; j < l; j++) {
                    node = children[j];
                    if (node.polygon) {
                        node.polygon = node.polygon.flipped();
                    }
                    queue.push(node.children);
                }
            }
        },

        recursivelyInvalidatePolygon: function() {
            var node = this;
            while (node.polygon) {
                node.polygon = null;
                if (node.parent) {
                    node = node.parent;
                }
            }
        }
    };



    // # class Tree
    // This is the root of a BSP tree
    // We are using this separate class for the root of the tree, to hold the PolygonTreeNode root
    // The actual tree is kept in this.rootnode
    CSG.Tree = function(polygons) {
        this.polygonTree = new CSG.PolygonTreeNode();
        this.rootnode = new CSG.Node(null);
        if (polygons) this.addPolygons(polygons);
    };

    CSG.Tree.prototype = {
        invert: function() {
            this.polygonTree.invert();
            this.rootnode.invert();
        },

        // Remove all polygons in this BSP tree that are inside the other BSP tree
        // `tree`.
        clipTo: function(tree, alsoRemovecoplanarFront) {
            alsoRemovecoplanarFront = alsoRemovecoplanarFront ? true : false;
            this.rootnode.clipTo(tree, alsoRemovecoplanarFront);
        },

        allPolygons: function() {
            var result = [];
            this.polygonTree.getPolygons(result);
            return result;
        },

        addPolygons: function(polygons) {
            var _this = this;
            var polygontreenodes = polygons.map(function(p) {
                return _this.polygonTree.addChild(p);
            });
            this.rootnode.addPolygonTreeNodes(polygontreenodes);
        }
    };

    // # class Node
    // Holds a node in a BSP tree. A BSP tree is built from a collection of polygons
    // by picking a polygon to split along.
    // Polygons are not stored directly in the tree, but in PolygonTreeNodes, stored in
    // this.polygontreenodes. Those PolygonTreeNodes are children of the owning
    // CSG.Tree.polygonTree
    // This is not a leafy BSP tree since there is
    // no distinction between internal and leaf nodes.
    CSG.Node = function(parent) {
        this.plane = null;
        this.front = null;
        this.back = null;
        this.polygontreenodes = [];
        this.parent = parent;
    };

    CSG.Node.prototype = {
        // Convert solid space to empty space and empty space to solid space.
        invert: function() {
            var queue = [this];
            var i, node;
            for (var i = 0; i < queue.length; i++) {
                node = queue[i];
                if(node.plane) node.plane = node.plane.flipped();
                if(node.front) queue.push(node.front);
                if(node.back) queue.push(node.back);
                var temp = node.front;
                node.front = node.back;
                node.back = temp;
            }
        },

        // clip polygontreenodes to our plane
        // calls remove() for all clipped PolygonTreeNodes
        clipPolygons: function(polygontreenodes, alsoRemovecoplanarFront) {
            var args = {'node': this, 'polygontreenodes': polygontreenodes }
            var node;
            var stack = [];

            do {
                node = args.node;
                polygontreenodes = args.polygontreenodes;

                // begin "function"
                if(node.plane) {
                    var backnodes = [];
                    var frontnodes = [];
                    var coplanarfrontnodes = alsoRemovecoplanarFront ? backnodes : frontnodes;
                    var plane = node.plane;
                    var numpolygontreenodes = polygontreenodes.length;
                    for(i = 0; i < numpolygontreenodes; i++) {
                        var node1 = polygontreenodes[i];
                        if(!node1.isRemoved()) {
                            node1.splitByPlane(plane, coplanarfrontnodes, backnodes, frontnodes, backnodes);
                        }
                    }

                    if(node.front && (frontnodes.length > 0)) {
                        stack.push({'node': node.front, 'polygontreenodes': frontnodes});
                    }
                    var numbacknodes = backnodes.length;
                    if (node.back && (numbacknodes > 0)) {
                        stack.push({'node': node.back, 'polygontreenodes': backnodes});
                    } else {
                        // there's nothing behind this plane. Delete the nodes behind this plane:
                        for (var i = 0; i < numbacknodes; i++) {
                            backnodes[i].remove();
                        }
                    }
                }
                args = stack.pop();
            } while (typeof(args) !== 'undefined');
        },

        // Remove all polygons in this BSP tree that are inside the other BSP tree
        // `tree`.
        clipTo: function(tree, alsoRemovecoplanarFront) {
            var node = this, stack = [];
            do {
                if(node.polygontreenodes.length > 0) {
                    tree.rootnode.clipPolygons(node.polygontreenodes, alsoRemovecoplanarFront);
                }
                if(node.front) stack.push(node.front);
                if(node.back) stack.push(node.back);
                node = stack.pop();
            } while(typeof(node) !== 'undefined');
        },

        addPolygonTreeNodes: function(polygontreenodes) {
            var args = {'node': this, 'polygontreenodes': polygontreenodes };
            var node;
            var stack = [];
            do {
                node = args.node;
                polygontreenodes = args.polygontreenodes;

                if (polygontreenodes.length === 0) {
                    args = stack.pop();
                    continue;
                }
                var _this = node;
                if (!node.plane) {
                    var bestplane = polygontreenodes[0].getPolygon().plane;
                    node.plane = bestplane;
                }
                var frontnodes = [];
                var backnodes = [];

                for (var i = 0, n = polygontreenodes.length ; i < n; ++i) {
                    polygontreenodes[i].splitByPlane(_this.plane, _this.polygontreenodes, backnodes, frontnodes, backnodes);
                }

                if (frontnodes.length > 0) {
                    if (!node.front) node.front = new CSG.Node(node);
                    stack.push({'node': node.front, 'polygontreenodes': frontnodes});
                }
                if (backnodes.length > 0) {
                    if (!node.back) node.back = new CSG.Node(node);
                    stack.push({'node': node.back, 'polygontreenodes': backnodes});
                }

                args = stack.pop();
            } while (typeof(args) !== 'undefined');
        },

        getParentPlaneNormals: function(normals, maxdepth) {
            if (maxdepth > 0) {
                if (this.parent) {
                    normals.push(this.parent.plane.normal);
                    this.parent.getParentPlaneNormals(normals, maxdepth - 1);
                }
            }
        }
    };

    //////////
    // # class Matrix4x4:
    // Represents a 4x4 matrix. Elements are specified in row order
    CSG.Matrix4x4 = function(elements) {
        if (arguments.length >= 1) {
            this.elements = elements;
        } else {
            // if no arguments passed: create unity matrix
            this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        }
    };

    CSG.Matrix4x4.prototype = {
        plus: function(m) {
            var r = [];
            for (var i = 0; i < 16; i++) {
                r[i] = this.elements[i] + m.elements[i];
            }
            return new CSG.Matrix4x4(r);
        },

        minus: function(m) {
            var r = [];
            for (var i = 0; i < 16; i++) {
                r[i] = this.elements[i] - m.elements[i];
            }
            return new CSG.Matrix4x4(r);
        },

        // right multiply by another 4x4 matrix:
        multiply: function(m) {
            // cache elements in local variables, for speedup:
            var this0 = this.elements[0];
            var this1 = this.elements[1];
            var this2 = this.elements[2];
            var this3 = this.elements[3];
            var this4 = this.elements[4];
            var this5 = this.elements[5];
            var this6 = this.elements[6];
            var this7 = this.elements[7];
            var this8 = this.elements[8];
            var this9 = this.elements[9];
            var this10 = this.elements[10];
            var this11 = this.elements[11];
            var this12 = this.elements[12];
            var this13 = this.elements[13];
            var this14 = this.elements[14];
            var this15 = this.elements[15];
            var m0 = m.elements[0];
            var m1 = m.elements[1];
            var m2 = m.elements[2];
            var m3 = m.elements[3];
            var m4 = m.elements[4];
            var m5 = m.elements[5];
            var m6 = m.elements[6];
            var m7 = m.elements[7];
            var m8 = m.elements[8];
            var m9 = m.elements[9];
            var m10 = m.elements[10];
            var m11 = m.elements[11];
            var m12 = m.elements[12];
            var m13 = m.elements[13];
            var m14 = m.elements[14];
            var m15 = m.elements[15];

            var result = [];
            result[0] = this0 * m0 + this1 * m4 + this2 * m8 + this3 * m12;
            result[1] = this0 * m1 + this1 * m5 + this2 * m9 + this3 * m13;
            result[2] = this0 * m2 + this1 * m6 + this2 * m10 + this3 * m14;
            result[3] = this0 * m3 + this1 * m7 + this2 * m11 + this3 * m15;
            result[4] = this4 * m0 + this5 * m4 + this6 * m8 + this7 * m12;
            result[5] = this4 * m1 + this5 * m5 + this6 * m9 + this7 * m13;
            result[6] = this4 * m2 + this5 * m6 + this6 * m10 + this7 * m14;
            result[7] = this4 * m3 + this5 * m7 + this6 * m11 + this7 * m15;
            result[8] = this8 * m0 + this9 * m4 + this10 * m8 + this11 * m12;
            result[9] = this8 * m1 + this9 * m5 + this10 * m9 + this11 * m13;
            result[10] = this8 * m2 + this9 * m6 + this10 * m10 + this11 * m14;
            result[11] = this8 * m3 + this9 * m7 + this10 * m11 + this11 * m15;
            result[12] = this12 * m0 + this13 * m4 + this14 * m8 + this15 * m12;
            result[13] = this12 * m1 + this13 * m5 + this14 * m9 + this15 * m13;
            result[14] = this12 * m2 + this13 * m6 + this14 * m10 + this15 * m14;
            result[15] = this12 * m3 + this13 * m7 + this14 * m11 + this15 * m15;
            return new CSG.Matrix4x4(result);
        },

        clone: function() {
            var elements = this.elements.map(function(p) {
                return p;
            });
            return new CSG.Matrix4x4(elements);
        },

        // Right multiply the matrix by a CSG.Vector3D (interpreted as 3 row, 1 column)
        // (result = M*v)
        // Fourth element is taken as 1
        rightMultiply1x3Vector: function(v) {
            var v0 = v._x;
            var v1 = v._y;
            var v2 = v._z;
            var v3 = 1;
            var x = v0 * this.elements[0] + v1 * this.elements[1] + v2 * this.elements[2] + v3 * this.elements[3];
            var y = v0 * this.elements[4] + v1 * this.elements[5] + v2 * this.elements[6] + v3 * this.elements[7];
            var z = v0 * this.elements[8] + v1 * this.elements[9] + v2 * this.elements[10] + v3 * this.elements[11];
            var w = v0 * this.elements[12] + v1 * this.elements[13] + v2 * this.elements[14] + v3 * this.elements[15];
            // scale such that fourth element becomes 1:
            if (w != 1) {
                var invw = 1.0 / w;
                x *= invw;
                y *= invw;
                z *= invw;
            }
            return new CSG.Vector3D(x, y, z);
        },

        // Multiply a CSG.Vector3D (interpreted as 3 column, 1 row) by this matrix
        // (result = v*M)
        // Fourth element is taken as 1
        leftMultiply1x3Vector: function(v) {
            var v0 = v._x;
            var v1 = v._y;
            var v2 = v._z;
            var v3 = 1;
            var x = v0 * this.elements[0] + v1 * this.elements[4] + v2 * this.elements[8] + v3 * this.elements[12];
            var y = v0 * this.elements[1] + v1 * this.elements[5] + v2 * this.elements[9] + v3 * this.elements[13];
            var z = v0 * this.elements[2] + v1 * this.elements[6] + v2 * this.elements[10] + v3 * this.elements[14];
            var w = v0 * this.elements[3] + v1 * this.elements[7] + v2 * this.elements[11] + v3 * this.elements[15];
            // scale such that fourth element becomes 1:
            if (w != 1) {
                var invw = 1.0 / w;
                x *= invw;
                y *= invw;
                z *= invw;
            }
            return new CSG.Vector3D(x, y, z);
        },

        // Right multiply the matrix by a CSG.Vector2D (interpreted as 2 row, 1 column)
        // (result = M*v)
        // Fourth element is taken as 1
        rightMultiply1x2Vector: function(v) {
            var v0 = v.x;
            var v1 = v.y;
            var v2 = 0;
            var v3 = 1;
            var x = v0 * this.elements[0] + v1 * this.elements[1] + v2 * this.elements[2] + v3 * this.elements[3];
            var y = v0 * this.elements[4] + v1 * this.elements[5] + v2 * this.elements[6] + v3 * this.elements[7];
            var z = v0 * this.elements[8] + v1 * this.elements[9] + v2 * this.elements[10] + v3 * this.elements[11];
            var w = v0 * this.elements[12] + v1 * this.elements[13] + v2 * this.elements[14] + v3 * this.elements[15];
            // scale such that fourth element becomes 1:
            if (w != 1) {
                var invw = 1.0 / w;
                x *= invw;
                y *= invw;
                z *= invw;
            }
            return new CSG.Vector2D(x, y);
        },

        // Multiply a CSG.Vector2D (interpreted as 2 column, 1 row) by this matrix
        // (result = v*M)
        // Fourth element is taken as 1
        leftMultiply1x2Vector: function(v) {
            var v0 = v.x;
            var v1 = v.y;
            var v2 = 0;
            var v3 = 1;
            var x = v0 * this.elements[0] + v1 * this.elements[4] + v2 * this.elements[8] + v3 * this.elements[12];
            var y = v0 * this.elements[1] + v1 * this.elements[5] + v2 * this.elements[9] + v3 * this.elements[13];
            var z = v0 * this.elements[2] + v1 * this.elements[6] + v2 * this.elements[10] + v3 * this.elements[14];
            var w = v0 * this.elements[3] + v1 * this.elements[7] + v2 * this.elements[11] + v3 * this.elements[15];
            // scale such that fourth element becomes 1:
            if (w != 1) {
                var invw = 1.0 / w;
                x *= invw;
                y *= invw;
                z *= invw;
            }
            return new CSG.Vector2D(x, y);
        },

        // determine whether this matrix is a mirroring transformation
        isMirroring: function() {
            var u = new CSG.Vector3D(this.elements[0], this.elements[4], this.elements[8]);
            var v = new CSG.Vector3D(this.elements[1], this.elements[5], this.elements[9]);
            var w = new CSG.Vector3D(this.elements[2], this.elements[6], this.elements[10]);

            // for a true orthogonal, non-mirrored base, u.cross(v) == w
            // If they have an opposite direction then we are mirroring
            var mirrorvalue = u.cross(v).dot(w);
            var ismirror = (mirrorvalue < 0);
            return ismirror;
        }
    };

    // return the unity matrix
    CSG.Matrix4x4.unity = function() {
        return new CSG.Matrix4x4();
    };

    // Create a rotation matrix for rotating around the x axis
    CSG.Matrix4x4.rotationX = function(degrees) {
        var radians = degrees * Math.PI * (1.0 / 180.0);
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        var els = [
            1, 0, 0, 0, 0, cos, sin, 0, 0, -sin, cos, 0, 0, 0, 0, 1
        ];
        return new CSG.Matrix4x4(els);
    };

    // Create a rotation matrix for rotating around the y axis
    CSG.Matrix4x4.rotationY = function(degrees) {
        var radians = degrees * Math.PI * (1.0 / 180.0);
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        var els = [
            cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, 0, 0, 0, 1
        ];
        return new CSG.Matrix4x4(els);
    };

    // Create a rotation matrix for rotating around the z axis
    CSG.Matrix4x4.rotationZ = function(degrees) {
        var radians = degrees * Math.PI * (1.0 / 180.0);
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        var els = [
            cos, sin, 0, 0, -sin, cos, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
        ];
        return new CSG.Matrix4x4(els);
    };

    // Matrix for rotation about arbitrary point and axis
    CSG.Matrix4x4.rotation = function(rotationCenter, rotationAxis, degrees) {
        rotationCenter = new CSG.Vector3D(rotationCenter);
        rotationAxis = new CSG.Vector3D(rotationAxis);
        var rotationPlane = CSG.Plane.fromNormalAndPoint(rotationAxis, rotationCenter);
        var orthobasis = new CSG.OrthoNormalBasis(rotationPlane);
        var transformation = CSG.Matrix4x4.translation(rotationCenter.negated());
        transformation = transformation.multiply(orthobasis.getProjectionMatrix());
        transformation = transformation.multiply(CSG.Matrix4x4.rotationZ(degrees));
        transformation = transformation.multiply(orthobasis.getInverseProjectionMatrix());
        transformation = transformation.multiply(CSG.Matrix4x4.translation(rotationCenter));
        return transformation;
    };

    // Create an affine matrix for translation:
    CSG.Matrix4x4.translation = function(v) {
        // parse as CSG.Vector3D, so we can pass an array or a CSG.Vector3D
        var vec = new CSG.Vector3D(v);
        var els = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, vec.x, vec.y, vec.z, 1];
        return new CSG.Matrix4x4(els);
    };

    // Create an affine matrix for mirroring into an arbitrary plane:
    CSG.Matrix4x4.mirroring = function(plane) {
        var nx = plane.normal.x;
        var ny = plane.normal.y;
        var nz = plane.normal.z;
        var w = plane.w;
        var els = [
            (1.0 - 2.0 * nx * nx), (-2.0 * ny * nx), (-2.0 * nz * nx), 0,
            (-2.0 * nx * ny), (1.0 - 2.0 * ny * ny), (-2.0 * nz * ny), 0,
            (-2.0 * nx * nz), (-2.0 * ny * nz), (1.0 - 2.0 * nz * nz), 0,
            (2.0 * nx * w), (2.0 * ny * w), (2.0 * nz * w), 1
        ];
        return new CSG.Matrix4x4(els);
    };

    // Create an affine matrix for scaling:
    CSG.Matrix4x4.scaling = function(v) {
        // parse as CSG.Vector3D, so we can pass an array or a CSG.Vector3D
        var vec = new CSG.Vector3D(v);
        var els = [
            vec.x, 0, 0, 0, 0, vec.y, 0, 0, 0, 0, vec.z, 0, 0, 0, 0, 1
        ];
        return new CSG.Matrix4x4(els);
    };

    ///////////////////////////////////////////////////
    // # class Vector2D:
    // Represents a 2 element vector
    CSG.Vector2D = function(x, y) {
        if (arguments.length == 2) {
            this._x = parseFloat(x);
            this._y = parseFloat(y);
        } else {
            var ok = true;
            if (arguments.length == 1) {
                if (typeof(x) == "object") {
                    if (x instanceof CSG.Vector2D) {
                        this._x = x._x;
                        this._y = x._y;
                    } else if (x instanceof Array) {
                        this._x = parseFloat(x[0]);
                        this._y = parseFloat(x[1]);
                    } else if (('x' in x) && ('y' in x)) {
                        this._x = parseFloat(x.x);
                        this._y = parseFloat(x.y);
                    } else ok = false;
                } else {
                    var v = parseFloat(x);
                    this._x = v;
                    this._y = v;
                }
            } else ok = false;
            if (ok) {
                if ((!CSG.IsFloat(this._x)) || (!CSG.IsFloat(this._y))) ok = false;
            }
            if (!ok) {
                throw new Error("wrong arguments");
            }
        }
    };

    CSG.Vector2D.fromAngle = function(radians) {
        return CSG.Vector2D.fromAngleRadians(radians);
    };

    CSG.Vector2D.fromAngleDegrees = function(degrees) {
        var radians = Math.PI * degrees / 180;
        return CSG.Vector2D.fromAngleRadians(radians);
    };

    CSG.Vector2D.fromAngleRadians = function(radians) {
        return CSG.Vector2D.Create(Math.cos(radians), Math.sin(radians));
    };

    // This does the same as new CSG.Vector2D(x,y) but it doesn't go through the constructor
    // and the parameters are not validated. Is much faster.
    CSG.Vector2D.Create = function(x, y) {
        var result = Object.create(CSG.Vector2D.prototype);
        result._x = x;
        result._y = y;
        return result;
    };

    CSG.Vector2D.prototype = {
        get x() {
            return this._x;
        },
        get y() {
            return this._y;
        },

        set x(v) {
            throw new Error("Vector2D is immutable");
        },
        set y(v) {
            throw new Error("Vector2D is immutable");
        },

        // extend to a 3D vector by adding a z coordinate:
        toVector3D: function(z) {
            return new CSG.Vector3D(this._x, this._y, z);
        },

        equals: function(a) {
            return (this._x == a._x) && (this._y == a._y);
        },

        clone: function() {
            return CSG.Vector2D.Create(this._x, this._y);
        },

        negated: function() {
            return CSG.Vector2D.Create(-this._x, -this._y);
        },

        plus: function(a) {
            return CSG.Vector2D.Create(this._x + a._x, this._y + a._y);
        },

        minus: function(a) {
            return CSG.Vector2D.Create(this._x - a._x, this._y - a._y);
        },

        times: function(a) {
            return CSG.Vector2D.Create(this._x * a, this._y * a);
        },

        dividedBy: function(a) {
            return CSG.Vector2D.Create(this._x / a, this._y / a);
        },

        dot: function(a) {
            return this._x * a._x + this._y * a._y;
        },

        lerp: function(a, t) {
            return this.plus(a.minus(this).times(t));
        },

        length: function() {
            return Math.sqrt(this.dot(this));
        },

        distanceTo: function(a) {
            return this.minus(a).length();
        },

        distanceToSquared: function(a) {
            return this.minus(a).lengthSquared();
        },

        lengthSquared: function() {
            return this.dot(this);
        },

        unit: function() {
            return this.dividedBy(this.length());
        },

        cross: function(a) {
            return this._x * a._y - this._y * a._x;
        },

        // returns the vector rotated by 90 degrees clockwise
        normal: function() {
            return CSG.Vector2D.Create(this._y, -this._x);
        },

        // Right multiply by a 4x4 matrix (the vector is interpreted as a row vector)
        // Returns a new CSG.Vector2D
        multiply4x4: function(matrix4x4) {
            return matrix4x4.leftMultiply1x2Vector(this);
        },

        transform: function(matrix4x4) {
            return matrix4x4.leftMultiply1x2Vector(this);
        },

        angle: function() {
            return this.angleRadians();
        },

        angleDegrees: function() {
            var radians = this.angleRadians();
            return 180 * radians / Math.PI;
        },

        angleRadians: function() {
            // y=sin, x=cos
            return Math.atan2(this._y, this._x);
        },

        min: function(p) {
            return CSG.Vector2D.Create(
                Math.min(this._x, p._x), Math.min(this._y, p._y));
        },

        max: function(p) {
            return CSG.Vector2D.Create(
                Math.max(this._x, p._x), Math.max(this._y, p._y));
        },

        toString: function() {
            return "(" + this._x.toFixed(2) + ", " + this._y.toFixed(2) + ")";
        },

        abs: function() {
            return CSG.Vector2D.Create(Math.abs(this._x), Math.abs(this._y));
        },
    };


    // # class Line2D
    // Represents a directional line in 2D space
    // A line is parametrized by its normal vector (perpendicular to the line, rotated 90 degrees counter clockwise)
    // and w. The line passes through the point <normal>.times(w).
    // normal must be a unit vector!
    // Equation: p is on line if normal.dot(p)==w
    CSG.Line2D = function(normal, w) {
        normal = new CSG.Vector2D(normal);
        w = parseFloat(w);
        var l = normal.length();
        // normalize:
        w *= l;
        normal = normal.times(1.0 / l);
        this.normal = normal;
        this.w = w;
    };

    CSG.Line2D.fromPoints = function(p1, p2) {
        p1 = new CSG.Vector2D(p1);
        p2 = new CSG.Vector2D(p2);
        var direction = p2.minus(p1);
        var normal = direction.normal().negated().unit();
        var w = p1.dot(normal);
        return new CSG.Line2D(normal, w);
    };

    CSG.Line2D.prototype = {
        // same line but opposite direction:
        reverse: function() {
            return new CSG.Line2D(this.normal.negated(), -this.w);
        },

        equals: function(l) {
            return (l.normal.equals(this.normal) && (l.w == this.w));
        },

        origin: function() {
            return this.normal.times(this.w);
        },

        direction: function() {
            return this.normal.normal();
        },

        xAtY: function(y) {
            // (py == y) && (normal * p == w)
            // -> px = (w - normal._y * y) / normal.x
            var x = (this.w - this.normal._y * y) / this.normal.x;
            return x;
        },

        absDistanceToPoint: function(point) {
            point = new CSG.Vector2D(point);
            var point_projected = point.dot(this.normal);
            var distance = Math.abs(point_projected - this.w);
            return distance;
        },
        /*FIXME: has error - origin is not defined, the method is never used
         closestPoint: function(point) {
             point = new CSG.Vector2D(point);
             var vector = point.dot(this.direction());
             return origin.plus(vector);
         },
         */

        // intersection between two lines, returns point as Vector2D
        intersectWithLine: function(line2d) {
            var point = CSG.solve2Linear(this.normal.x, this.normal.y, line2d.normal.x, line2d.normal.y, this.w, line2d.w);
            point = new CSG.Vector2D(point); // make  vector2d
            return point;
        },

        transform: function(matrix4x4) {
            var origin = new CSG.Vector2D(0, 0);
            var pointOnPlane = this.normal.times(this.w);
            var neworigin = origin.multiply4x4(matrix4x4);
            var neworiginPlusNormal = this.normal.multiply4x4(matrix4x4);
            var newnormal = neworiginPlusNormal.minus(neworigin);
            var newpointOnPlane = pointOnPlane.multiply4x4(matrix4x4);
            var neww = newnormal.dot(newpointOnPlane);
            return new CSG.Line2D(newnormal, neww);
        }
    };

    // # class Line3D
    // Represents a line in 3D space
    // direction must be a unit vector
    // point is a random point on the line
    CSG.Line3D = function(point, direction) {
        point = new CSG.Vector3D(point);
        direction = new CSG.Vector3D(direction);
        this.point = point;
        this.direction = direction.unit();
    };

    CSG.Line3D.fromPoints = function(p1, p2) {
        p1 = new CSG.Vector3D(p1);
        p2 = new CSG.Vector3D(p2);
        var direction = p2.minus(p1);
        return new CSG.Line3D(p1, direction);
    };

    CSG.Line3D.fromPlanes = function(p1, p2) {
        var direction = p1.normal.cross(p2.normal);
        var l = direction.length();
        if (l < 1e-10) {
            throw new Error("Parallel planes");
        }
        direction = direction.times(1.0 / l);

        var mabsx = Math.abs(direction.x);
        var mabsy = Math.abs(direction.y);
        var mabsz = Math.abs(direction.z);
        var origin;
        if ((mabsx >= mabsy) && (mabsx >= mabsz)) {
            // direction vector is mostly pointing towards x
            // find a point p for which x is zero:
            var r = CSG.solve2Linear(p1.normal.y, p1.normal.z, p2.normal.y, p2.normal.z, p1.w, p2.w);
            origin = new CSG.Vector3D(0, r[0], r[1]);
        } else if ((mabsy >= mabsx) && (mabsy >= mabsz)) {
            // find a point p for which y is zero:
            var r = CSG.solve2Linear(p1.normal.x, p1.normal.z, p2.normal.x, p2.normal.z, p1.w, p2.w);
            origin = new CSG.Vector3D(r[0], 0, r[1]);
        } else {
            // find a point p for which z is zero:
            var r = CSG.solve2Linear(p1.normal.x, p1.normal.y, p2.normal.x, p2.normal.y, p1.w, p2.w);
            origin = new CSG.Vector3D(r[0], r[1], 0);
        }
        return new CSG.Line3D(origin, direction);
    };


    CSG.Line3D.prototype = {
        intersectWithPlane: function(plane) {
            // plane: plane.normal * p = plane.w
            // line: p=line.point + labda * line.direction
            var labda = (plane.w - plane.normal.dot(this.point)) / plane.normal.dot(this.direction);
            var point = this.point.plus(this.direction.times(labda));
            return point;
        },

        clone: function(line) {
            return new CSG.Line3D(this.point.clone(), this.direction.clone());
        },

        reverse: function() {
            return new CSG.Line3D(this.point.clone(), this.direction.negated());
        },

        transform: function(matrix4x4) {
            var newpoint = this.point.multiply4x4(matrix4x4);
            var pointPlusDirection = this.point.plus(this.direction);
            var newPointPlusDirection = pointPlusDirection.multiply4x4(matrix4x4);
            var newdirection = newPointPlusDirection.minus(newpoint);
            return new CSG.Line3D(newpoint, newdirection);
        },

        closestPointOnLine: function(point) {
            point = new CSG.Vector3D(point);
            var t = point.minus(this.point).dot(this.direction) / this.direction.dot(this.direction);
            var closestpoint = this.point.plus(this.direction.times(t));
            return closestpoint;
        },

        distanceToPoint: function(point) {
            point = new CSG.Vector3D(point);
            var closestpoint = this.closestPointOnLine(point);
            var distancevector = point.minus(closestpoint);
            var distance = distancevector.length();
            return distance;
        },

        equals: function(line3d) {
            if (!this.direction.equals(line3d.direction)) return false;
            var distance = this.distanceToPoint(line3d.point);
            if (distance > 1e-8) return false;
            return true;
        }
    };


    // # class OrthoNormalBasis
    // Reprojects points on a 3D plane onto a 2D plane
    // or from a 2D plane back onto the 3D plane
    CSG.OrthoNormalBasis = function(plane, rightvector) {
        if (arguments.length < 2) {
            // choose an arbitrary right hand vector, making sure it is somewhat orthogonal to the plane normal:
            rightvector = plane.normal.randomNonParallelVector();
        } else {
            rightvector = new CSG.Vector3D(rightvector);
        }
        this.v = plane.normal.cross(rightvector).unit();
        this.u = this.v.cross(plane.normal);
        this.plane = plane;
        this.planeorigin = plane.normal.times(plane.w);
    };

    // Get an orthonormal basis for the standard XYZ planes.
    // Parameters: the names of two 3D axes. The 2d x axis will map to the first given 3D axis, the 2d y 
    // axis will map to the second.
    // Prepend the axis with a "-" to invert the direction of this axis.
    // For example: CSG.OrthoNormalBasis.GetCartesian("-Y","Z")
    //   will return an orthonormal basis where the 2d X axis maps to the 3D inverted Y axis, and
    //   the 2d Y axis maps to the 3D Z axis.
    CSG.OrthoNormalBasis.GetCartesian = function(xaxisid, yaxisid) {
        var axisid = xaxisid + "/" + yaxisid;
        var planenormal, rightvector;
        if (axisid == "X/Y") {
            planenormal = [0, 0, 1];
            rightvector = [1, 0, 0];
        } else if (axisid == "Y/-X") {
            planenormal = [0, 0, 1];
            rightvector = [0, 1, 0];
        } else if (axisid == "-X/-Y") {
            planenormal = [0, 0, 1];
            rightvector = [-1, 0, 0];
        } else if (axisid == "-Y/X") {
            planenormal = [0, 0, 1];
            rightvector = [0, -1, 0];
        } else if (axisid == "-X/Y") {
            planenormal = [0, 0, -1];
            rightvector = [-1, 0, 0];
        } else if (axisid == "-Y/-X") {
            planenormal = [0, 0, -1];
            rightvector = [0, -1, 0];
        } else if (axisid == "X/-Y") {
            planenormal = [0, 0, -1];
            rightvector = [1, 0, 0];
        } else if (axisid == "Y/X") {
            planenormal = [0, 0, -1];
            rightvector = [0, 1, 0];
        } else if (axisid == "X/Z") {
            planenormal = [0, -1, 0];
            rightvector = [1, 0, 0];
        } else if (axisid == "Z/-X") {
            planenormal = [0, -1, 0];
            rightvector = [0, 0, 1];
        } else if (axisid == "-X/-Z") {
            planenormal = [0, -1, 0];
            rightvector = [-1, 0, 0];
        } else if (axisid == "-Z/X") {
            planenormal = [0, -1, 0];
            rightvector = [0, 0, -1];
        } else if (axisid == "-X/Z") {
            planenormal = [0, 1, 0];
            rightvector = [-1, 0, 0];
        } else if (axisid == "-Z/-X") {
            planenormal = [0, 1, 0];
            rightvector = [0, 0, -1];
        } else if (axisid == "X/-Z") {
            planenormal = [0, 1, 0];
            rightvector = [1, 0, 0];
        } else if (axisid == "Z/X") {
            planenormal = [0, 1, 0];
            rightvector = [0, 0, 1];
        } else if (axisid == "Y/Z") {
            planenormal = [1, 0, 0];
            rightvector = [0, 1, 0];
        } else if (axisid == "Z/-Y") {
            planenormal = [1, 0, 0];
            rightvector = [0, 0, 1];
        } else if (axisid == "-Y/-Z") {
            planenormal = [1, 0, 0];
            rightvector = [0, -1, 0];
        } else if (axisid == "-Z/Y") {
            planenormal = [1, 0, 0];
            rightvector = [0, 0, -1];
        } else if (axisid == "-Y/Z") {
            planenormal = [-1, 0, 0];
            rightvector = [0, -1, 0];
        } else if (axisid == "-Z/-Y") {
            planenormal = [-1, 0, 0];
            rightvector = [0, 0, -1];
        } else if (axisid == "Y/-Z") {
            planenormal = [-1, 0, 0];
            rightvector = [0, 1, 0];
        } else if (axisid == "Z/Y") {
            planenormal = [-1, 0, 0];
            rightvector = [0, 0, 1];
        } else {
            throw new Error("CSG.OrthoNormalBasis.GetCartesian: invalid combination of axis identifiers. Should pass two string arguments from [X,Y,Z,-X,-Y,-Z], being two different axes.");
        }
        return new CSG.OrthoNormalBasis(new CSG.Plane(new CSG.Vector3D(planenormal), 0), new CSG.Vector3D(rightvector));
    };

    /*
    // test code for CSG.OrthoNormalBasis.GetCartesian()
    CSG.OrthoNormalBasis.GetCartesian_Test=function() {
      var axisnames=["X","Y","Z","-X","-Y","-Z"];
      var axisvectors=[[1,0,0], [0,1,0], [0,0,1], [-1,0,0], [0,-1,0], [0,0,-1]];
      for(var axis1=0; axis1 < 3; axis1++) {
        for(var axis1inverted=0; axis1inverted < 2; axis1inverted++) {
          var axis1name=axisnames[axis1+3*axis1inverted];
          var axis1vector=axisvectors[axis1+3*axis1inverted];
          for(var axis2=0; axis2 < 3; axis2++) {
            if(axis2 != axis1) {
              for(var axis2inverted=0; axis2inverted < 2; axis2inverted++) {
                var axis2name=axisnames[axis2+3*axis2inverted];
                var axis2vector=axisvectors[axis2+3*axis2inverted];
                var orthobasis=CSG.OrthoNormalBasis.GetCartesian(axis1name, axis2name);
                var test1=orthobasis.to3D(new CSG.Vector2D([1,0]));
                var test2=orthobasis.to3D(new CSG.Vector2D([0,1]));
                var expected1=new CSG.Vector3D(axis1vector);
                var expected2=new CSG.Vector3D(axis2vector);
                var d1=test1.distanceTo(expected1);
                var d2=test2.distanceTo(expected2);
                if( (d1 > 0.01) || (d2 > 0.01) ) {
                  throw new Error("Wrong!");
      }}}}}}
      throw new Error("OK");
    };
    */

    // The z=0 plane, with the 3D x and y vectors mapped to the 2D x and y vector
    CSG.OrthoNormalBasis.Z0Plane = function() {
        var plane = new CSG.Plane(new CSG.Vector3D([0, 0, 1]), 0);
        return new CSG.OrthoNormalBasis(plane, new CSG.Vector3D([1, 0, 0]));
    };

    CSG.OrthoNormalBasis.prototype = {
        getProjectionMatrix: function() {
            return new CSG.Matrix4x4([
                this.u.x, this.v.x, this.plane.normal.x, 0,
                this.u.y, this.v.y, this.plane.normal.y, 0,
                this.u.z, this.v.z, this.plane.normal.z, 0,
                0, 0, -this.plane.w, 1
            ]);
        },

        getInverseProjectionMatrix: function() {
            var p = this.plane.normal.times(this.plane.w);
            return new CSG.Matrix4x4([
                this.u.x, this.u.y, this.u.z, 0,
                this.v.x, this.v.y, this.v.z, 0,
                this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, 0,
                p.x, p.y, p.z, 1
            ]);
        },

        to2D: function(vec3) {
            return new CSG.Vector2D(vec3.dot(this.u), vec3.dot(this.v));
        },

        to3D: function(vec2) {
            return this.planeorigin.plus(this.u.times(vec2.x)).plus(this.v.times(vec2.y));
        },

        line3Dto2D: function(line3d) {
            var a = line3d.point;
            var b = line3d.direction.plus(a);
            var a2d = this.to2D(a);
            var b2d = this.to2D(b);
            return CSG.Line2D.fromPoints(a2d, b2d);
        },

        line2Dto3D: function(line2d) {
            var a = line2d.origin();
            var b = line2d.direction().plus(a);
            var a3d = this.to3D(a);
            var b3d = this.to3D(b);
            return CSG.Line3D.fromPoints(a3d, b3d);
        },

        transform: function(matrix4x4) {
            // todo: this may not work properly in case of mirroring
            var newplane = this.plane.transform(matrix4x4);
            var rightpoint_transformed = this.u.transform(matrix4x4);
            var origin_transformed = new CSG.Vector3D(0, 0, 0).transform(matrix4x4);
            var newrighthandvector = rightpoint_transformed.minus(origin_transformed);
            var newbasis = new CSG.OrthoNormalBasis(newplane, newrighthandvector);
            return newbasis;
        }
    };

    function insertSorted(array, element, comparefunc) {
        var leftbound = 0;
        var rightbound = array.length;
        while (rightbound > leftbound) {
            var testindex = Math.floor((leftbound + rightbound) / 2);
            var testelement = array[testindex];
            var compareresult = comparefunc(element, testelement);
            if (compareresult > 0) // element > testelement
            {
                leftbound = testindex + 1;
            } else {
                rightbound = testindex;
            }
        }
        array.splice(leftbound, 0, element);
    }

    // Get the x coordinate of a point with a certain y coordinate, interpolated between two
    // points (CSG.Vector2D).
    // Interpolation is robust even if the points have the same y coordinate
    CSG.interpolateBetween2DPointsForY = function(point1, point2, y) {
        var f1 = y - point1.y;
        var f2 = point2.y - point1.y;
        if (f2 < 0) {
            f1 = -f1;
            f2 = -f2;
        }
        var t;
        if (f1 <= 0) {
            t = 0.0;
        } else if (f1 >= f2) {
            t = 1.0;
        } else if (f2 < 1e-10) {
            t = 0.5;
        } else {
            t = f1 / f2;
        }
        var result = point1.x + t * (point2.x - point1.x);
        return result;
    };

    // Retesselation function for a set of coplanar polygons. See the introduction at the top of
    // this file.
    CSG.reTesselateCoplanarPolygons = function(sourcepolygons, destpolygons) {
        var EPS = 1e-5;

        var numpolygons = sourcepolygons.length;
        if (numpolygons > 0) {
            var plane = sourcepolygons[0].plane;
            var shared = sourcepolygons[0].shared;
            var orthobasis = new CSG.OrthoNormalBasis(plane);
            var polygonvertices2d = []; // array of array of CSG.Vector2D
            var polygontopvertexindexes = []; // array of indexes of topmost vertex per polygon
            var topy2polygonindexes = {};
            var ycoordinatetopolygonindexes = {};

            var xcoordinatebins = {};
            var ycoordinatebins = {};

            // convert all polygon vertices to 2D
            // Make a list of all encountered y coordinates
            // And build a map of all polygons that have a vertex at a certain y coordinate:
            var ycoordinateBinningFactor = 1.0 / EPS * 10;
            for (var polygonindex = 0; polygonindex < numpolygons; polygonindex++) {
                var poly3d = sourcepolygons[polygonindex];
                var vertices2d = [];
                var numvertices = poly3d.vertices.length;
                var minindex = -1;
                if (numvertices > 0) {
                    var miny, maxy, maxindex;
                    for (var i = 0; i < numvertices; i++) {
                        var pos2d = orthobasis.to2D(poly3d.vertices[i].pos);
                        // perform binning of y coordinates: If we have multiple vertices very
                        // close to each other, give them the same y coordinate:
                        var ycoordinatebin = Math.floor(pos2d.y * ycoordinateBinningFactor);
                        var newy;
                        if (ycoordinatebin in ycoordinatebins) {
                            newy = ycoordinatebins[ycoordinatebin];
                        } else if (ycoordinatebin + 1 in ycoordinatebins) {
                            newy = ycoordinatebins[ycoordinatebin + 1];
                        } else if (ycoordinatebin - 1 in ycoordinatebins) {
                            newy = ycoordinatebins[ycoordinatebin - 1];
                        } else {
                            newy = pos2d.y;
                            ycoordinatebins[ycoordinatebin] = pos2d.y;
                        }
                        pos2d = CSG.Vector2D.Create(pos2d.x, newy);
                        vertices2d.push(pos2d);
                        var y = pos2d.y;
                        if ((i === 0) || (y < miny)) {
                            miny = y;
                            minindex = i;
                        }
                        if ((i === 0) || (y > maxy)) {
                            maxy = y;
                            maxindex = i;
                        }
                        if (!(y in ycoordinatetopolygonindexes)) {
                            ycoordinatetopolygonindexes[y] = {};
                        }
                        ycoordinatetopolygonindexes[y][polygonindex] = true;
                    }
                    if (miny >= maxy) {
                        // degenerate polygon, all vertices have same y coordinate. Just ignore it from now:
                        vertices2d = [];
                        numvertices = 0;
                        minindex = -1;
                    } else {
                        if (!(miny in topy2polygonindexes)) {
                            topy2polygonindexes[miny] = [];
                        }
                        topy2polygonindexes[miny].push(polygonindex);
                    }
                } // if(numvertices > 0)
                // reverse the vertex order:
                vertices2d.reverse();
                minindex = numvertices - minindex - 1;
                polygonvertices2d.push(vertices2d);
                polygontopvertexindexes.push(minindex);
            }
            var ycoordinates = [];
            for (var ycoordinate in ycoordinatetopolygonindexes) ycoordinates.push(ycoordinate);
            ycoordinates.sort(fnNumberSort);

            // Now we will iterate over all y coordinates, from lowest to highest y coordinate
            // activepolygons: source polygons that are 'active', i.e. intersect with our y coordinate
            //   Is sorted so the polygons are in left to right order
            // Each element in activepolygons has these properties:
            //        polygonindex: the index of the source polygon (i.e. an index into the sourcepolygons
            //                      and polygonvertices2d arrays)
            //        leftvertexindex: the index of the vertex at the left side of the polygon (lowest x)
            //                         that is at or just above the current y coordinate
            //        rightvertexindex: dito at right hand side of polygon
            //        topleft, bottomleft: coordinates of the left side of the polygon crossing the current y coordinate
            //        topright, bottomright: coordinates of the right hand side of the polygon crossing the current y coordinate
            var activepolygons = [];
            var prevoutpolygonrow = [];
            for (var yindex = 0; yindex < ycoordinates.length; yindex++) {
                var newoutpolygonrow = [];
                var ycoordinate_as_string = ycoordinates[yindex];
                var ycoordinate = Number(ycoordinate_as_string);

                // update activepolygons for this y coordinate:
                // - Remove any polygons that end at this y coordinate
                // - update leftvertexindex and rightvertexindex (which point to the current vertex index
                //   at the the left and right side of the polygon
                // Iterate over all polygons that have a corner at this y coordinate:
                var polygonindexeswithcorner = ycoordinatetopolygonindexes[ycoordinate_as_string];
                for (var activepolygonindex = 0; activepolygonindex < activepolygons.length; ++activepolygonindex) {
                    var activepolygon = activepolygons[activepolygonindex];
                    var polygonindex = activepolygon.polygonindex;
                    if (polygonindexeswithcorner[polygonindex]) {
                        // this active polygon has a corner at this y coordinate:
                        var vertices2d = polygonvertices2d[polygonindex];
                        var numvertices = vertices2d.length;
                        var newleftvertexindex = activepolygon.leftvertexindex;
                        var newrightvertexindex = activepolygon.rightvertexindex;
                        // See if we need to increase leftvertexindex or decrease rightvertexindex:
                        while (true) {
                            var nextleftvertexindex = newleftvertexindex + 1;
                            if (nextleftvertexindex >= numvertices) nextleftvertexindex = 0;
                            if (vertices2d[nextleftvertexindex].y != ycoordinate) break;
                            newleftvertexindex = nextleftvertexindex;
                        }
                        var nextrightvertexindex = newrightvertexindex - 1;
                        if (nextrightvertexindex < 0) nextrightvertexindex = numvertices - 1;
                        if (vertices2d[nextrightvertexindex].y == ycoordinate) {
                            newrightvertexindex = nextrightvertexindex;
                        }
                        if ((newleftvertexindex != activepolygon.leftvertexindex) && (newleftvertexindex == newrightvertexindex)) {
                            // We have increased leftvertexindex or decreased rightvertexindex, and now they point to the same vertex
                            // This means that this is the bottom point of the polygon. We'll remove it:
                            activepolygons.splice(activepolygonindex, 1);
                            --activepolygonindex;
                        } else {
                            activepolygon.leftvertexindex = newleftvertexindex;
                            activepolygon.rightvertexindex = newrightvertexindex;
                            activepolygon.topleft = vertices2d[newleftvertexindex];
                            activepolygon.topright = vertices2d[newrightvertexindex];
                            var nextleftvertexindex = newleftvertexindex + 1;
                            if (nextleftvertexindex >= numvertices) nextleftvertexindex = 0;
                            activepolygon.bottomleft = vertices2d[nextleftvertexindex];
                            var nextrightvertexindex = newrightvertexindex - 1;
                            if (nextrightvertexindex < 0) nextrightvertexindex = numvertices - 1;
                            activepolygon.bottomright = vertices2d[nextrightvertexindex];
                        }
                    } // if polygon has corner here
                } // for activepolygonindex
                var nextycoordinate;
                if (yindex >= ycoordinates.length - 1) {
                    // last row, all polygons must be finished here:
                    activepolygons = [];
                    nextycoordinate = null;
                } else // yindex < ycoordinates.length-1
                {
                    nextycoordinate = Number(ycoordinates[yindex + 1]);
                    var middleycoordinate = 0.5 * (ycoordinate + nextycoordinate);
                    // update activepolygons by adding any polygons that start here:
                    var startingpolygonindexes = topy2polygonindexes[ycoordinate_as_string];
                    for (var polygonindex_key in startingpolygonindexes) {
                        var polygonindex = startingpolygonindexes[polygonindex_key];
                        var vertices2d = polygonvertices2d[polygonindex];
                        var numvertices = vertices2d.length;
                        var topvertexindex = polygontopvertexindexes[polygonindex];
                        // the top of the polygon may be a horizontal line. In that case topvertexindex can point to any point on this line.
                        // Find the left and right topmost vertices which have the current y coordinate:
                        var topleftvertexindex = topvertexindex;
                        while (true) {
                            var i = topleftvertexindex + 1;
                            if (i >= numvertices) i = 0;
                            if (vertices2d[i].y != ycoordinate) break;
                            if (i == topvertexindex) break; // should not happen, but just to prevent endless loops
                            topleftvertexindex = i;
                        }
                        var toprightvertexindex = topvertexindex;
                        while (true) {
                            var i = toprightvertexindex - 1;
                            if (i < 0) i = numvertices - 1;
                            if (vertices2d[i].y != ycoordinate) break;
                            if (i == topleftvertexindex) break; // should not happen, but just to prevent endless loops
                            toprightvertexindex = i;
                        }
                        var nextleftvertexindex = topleftvertexindex + 1;
                        if (nextleftvertexindex >= numvertices) nextleftvertexindex = 0;
                        var nextrightvertexindex = toprightvertexindex - 1;
                        if (nextrightvertexindex < 0) nextrightvertexindex = numvertices - 1;
                        var newactivepolygon = {
                            polygonindex: polygonindex,
                            leftvertexindex: topleftvertexindex,
                            rightvertexindex: toprightvertexindex,
                            topleft: vertices2d[topleftvertexindex],
                            topright: vertices2d[toprightvertexindex],
                            bottomleft: vertices2d[nextleftvertexindex],
                            bottomright: vertices2d[nextrightvertexindex],
                        };
                        insertSorted(activepolygons, newactivepolygon, function(el1, el2) {
                            var x1 = CSG.interpolateBetween2DPointsForY(
                                el1.topleft, el1.bottomleft, middleycoordinate);
                            var x2 = CSG.interpolateBetween2DPointsForY(
                                el2.topleft, el2.bottomleft, middleycoordinate);
                            if (x1 > x2) return 1;
                            if (x1 < x2) return -1;
                            return 0;
                        });
                    } // for(var polygonindex in startingpolygonindexes)
                } //  yindex < ycoordinates.length-1
                //if( (yindex == ycoordinates.length-1) || (nextycoordinate - ycoordinate > EPS) )
                if (true) {
                    // Now activepolygons is up to date
                    // Build the output polygons for the next row in newoutpolygonrow:
                    for (var activepolygon_key in activepolygons) {
                        var activepolygon = activepolygons[activepolygon_key];
                        var polygonindex = activepolygon.polygonindex;
                        var vertices2d = polygonvertices2d[polygonindex];
                        var numvertices = vertices2d.length;

                        var x = CSG.interpolateBetween2DPointsForY(activepolygon.topleft, activepolygon.bottomleft, ycoordinate);
                        var topleft = CSG.Vector2D.Create(x, ycoordinate);
                        x = CSG.interpolateBetween2DPointsForY(activepolygon.topright, activepolygon.bottomright, ycoordinate);
                        var topright = CSG.Vector2D.Create(x, ycoordinate);
                        x = CSG.interpolateBetween2DPointsForY(activepolygon.topleft, activepolygon.bottomleft, nextycoordinate);
                        var bottomleft = CSG.Vector2D.Create(x, nextycoordinate);
                        x = CSG.interpolateBetween2DPointsForY(activepolygon.topright, activepolygon.bottomright, nextycoordinate);
                        var bottomright = CSG.Vector2D.Create(x, nextycoordinate);
                        var outpolygon = {
                            topleft: topleft,
                            topright: topright,
                            bottomleft: bottomleft,
                            bottomright: bottomright,
                            leftline: CSG.Line2D.fromPoints(topleft, bottomleft),
                            rightline: CSG.Line2D.fromPoints(bottomright, topright)
                        };
                        if (newoutpolygonrow.length > 0) {
                            var prevoutpolygon = newoutpolygonrow[newoutpolygonrow.length - 1];
                            var d1 = outpolygon.topleft.distanceTo(prevoutpolygon.topright);
                            var d2 = outpolygon.bottomleft.distanceTo(prevoutpolygon.bottomright);
                            if ((d1 < EPS) && (d2 < EPS)) {
                                // we can join this polygon with the one to the left:
                                outpolygon.topleft = prevoutpolygon.topleft;
                                outpolygon.leftline = prevoutpolygon.leftline;
                                outpolygon.bottomleft = prevoutpolygon.bottomleft;
                                newoutpolygonrow.splice(newoutpolygonrow.length - 1, 1);
                            }
                        }
                        newoutpolygonrow.push(outpolygon);
                    } // for(activepolygon in activepolygons)
                    if (yindex > 0) {
                        // try to match the new polygons against the previous row:
                        var prevcontinuedindexes = {};
                        var matchedindexes = {};
                        for (var i = 0; i < newoutpolygonrow.length; i++) {
                            var thispolygon = newoutpolygonrow[i];
                            for (var ii = 0; ii < prevoutpolygonrow.length; ii++) {
                                if (!matchedindexes[ii]) // not already processed?
                                {
                                    // We have a match if the sidelines are equal or if the top coordinates
                                    // are on the sidelines of the previous polygon
                                    var prevpolygon = prevoutpolygonrow[ii];
                                    if (prevpolygon.bottomleft.distanceTo(thispolygon.topleft) < EPS) {
                                        if (prevpolygon.bottomright.distanceTo(thispolygon.topright) < EPS) {
                                            // Yes, the top of this polygon matches the bottom of the previous:
                                            matchedindexes[ii] = true;
                                            // Now check if the joined polygon would remain convex:
                                            var d1 = thispolygon.leftline.direction().x - prevpolygon.leftline.direction().x;
                                            var d2 = thispolygon.rightline.direction().x - prevpolygon.rightline.direction().x;
                                            var leftlinecontinues = Math.abs(d1) < EPS;
                                            var rightlinecontinues = Math.abs(d2) < EPS;
                                            var leftlineisconvex = leftlinecontinues || (d1 >= 0);
                                            var rightlineisconvex = rightlinecontinues || (d2 >= 0);
                                            if (leftlineisconvex && rightlineisconvex) {
                                                // yes, both sides have convex corners:
                                                // This polygon will continue the previous polygon
                                                thispolygon.outpolygon = prevpolygon.outpolygon;
                                                thispolygon.leftlinecontinues = leftlinecontinues;
                                                thispolygon.rightlinecontinues = rightlinecontinues;
                                                prevcontinuedindexes[ii] = true;
                                            }
                                            break;
                                        }
                                    }
                                } // if(!prevcontinuedindexes[ii])
                            } // for ii
                        } // for i
                        for (var ii = 0; ii < prevoutpolygonrow.length; ii++) {
                            if (!prevcontinuedindexes[ii]) {
                                // polygon ends here
                                // Finish the polygon with the last point(s):
                                var prevpolygon = prevoutpolygonrow[ii];
                                prevpolygon.outpolygon.rightpoints.push(prevpolygon.bottomright);
                                if (prevpolygon.bottomright.distanceTo(prevpolygon.bottomleft) > EPS) {
                                    // polygon ends with a horizontal line:
                                    prevpolygon.outpolygon.leftpoints.push(prevpolygon.bottomleft);
                                }
                                // reverse the left half so we get a counterclockwise circle:
                                prevpolygon.outpolygon.leftpoints.reverse();
                                var points2d = prevpolygon.outpolygon.rightpoints.concat(prevpolygon.outpolygon.leftpoints);
                                var vertices3d = [];
                                points2d.map(function(point2d) {
                                    var point3d = orthobasis.to3D(point2d);
                                    var vertex3d = new CSG.Vertex(point3d);
                                    vertices3d.push(vertex3d);
                                });
                                var polygon = new CSG.Polygon(vertices3d, shared, plane);
                                destpolygons.push(polygon);
                            }
                        }
                    } // if(yindex > 0)
                    for (var i = 0; i < newoutpolygonrow.length; i++) {
                        var thispolygon = newoutpolygonrow[i];
                        if (!thispolygon.outpolygon) {
                            // polygon starts here:
                            thispolygon.outpolygon = {
                                leftpoints: [],
                                rightpoints: []
                            };
                            thispolygon.outpolygon.leftpoints.push(thispolygon.topleft);
                            if (thispolygon.topleft.distanceTo(thispolygon.topright) > EPS) {
                                // we have a horizontal line at the top:
                                thispolygon.outpolygon.rightpoints.push(thispolygon.topright);
                            }
                        } else {
                            // continuation of a previous row
                            if (!thispolygon.leftlinecontinues) {
                                thispolygon.outpolygon.leftpoints.push(thispolygon.topleft);
                            }
                            if (!thispolygon.rightlinecontinues) {
                                thispolygon.outpolygon.rightpoints.push(thispolygon.topright);
                            }
                        }
                    }
                    prevoutpolygonrow = newoutpolygonrow;
                }
            } // for yindex
        } // if(numpolygons > 0)
    };

    ////////////////////////////////
    // ## class fuzzyFactory
    // This class acts as a factory for objects. We can search for an object with approximately
    // the desired properties (say a rectangle with width 2 and height 1)
    // The lookupOrCreate() method looks for an existing object (for example it may find an existing rectangle
    // with width 2.0001 and height 0.999. If no object is found, the user supplied callback is
    // called, which should generate a new object. The new object is inserted into the database
    // so it can be found by future lookupOrCreate() calls.
    // Constructor:
    //   numdimensions: the number of parameters for each object
    //     for example for a 2D rectangle this would be 2
    //   tolerance: The maximum difference for each parameter allowed to be considered a match
    CSG.fuzzyFactory = function(numdimensions, tolerance) {
        this.lookuptable = {};
        this.multiplier = 1.0 / tolerance;
    };

    CSG.fuzzyFactory.prototype = {
        // var obj = f.lookupOrCreate([el1, el2, el3], function(elements) {/* create the new object */});
        // Performs a fuzzy lookup of the object with the specified elements.
        // If found, returns the existing object
        // If not found, calls the supplied callback function which should create a new object with
        // the specified properties. This object is inserted in the lookup database.
        lookupOrCreate: function(els, creatorCallback) {
            var hash = "";
            var multiplier = this.multiplier;
            els.forEach(function(el) {
                var valueQuantized = Math.round(el * multiplier);
                hash += valueQuantized + "/";
            });
            if (hash in this.lookuptable) {
                return this.lookuptable[hash];
            } else {
                var object = creatorCallback(els);
                var hashparts = els.map(function(el) {
                    var q0 = Math.floor(el * multiplier);
                    var q1 = q0 + 1;
                    return ["" + q0 + "/", "" + q1 + "/"];
                });
                var numelements = els.length;
                var numhashes = 1 << numelements;
                for (var hashmask = 0; hashmask < numhashes; ++hashmask) {
                    var hashmask_shifted = hashmask;
                    hash = "";
                    hashparts.forEach(function(hashpart) {
                        hash += hashpart[hashmask_shifted & 1];
                        hashmask_shifted >>= 1;
                    });
                    this.lookuptable[hash] = object;
                }
                return object;
            }
        },
    };


    //////////////////////////////////////
    CSG.fuzzyCSGFactory = function() {
        this.vertexfactory = new CSG.fuzzyFactory(3, 1e-5);
        this.planefactory = new CSG.fuzzyFactory(4, 1e-5);
        this.polygonsharedfactory = {};
    };

    CSG.fuzzyCSGFactory.prototype = {
        getPolygonShared: function(sourceshared) {
            var hash = sourceshared.getHash();
            if (hash in this.polygonsharedfactory) {
                return this.polygonsharedfactory[hash];
            } else {
                this.polygonsharedfactory[hash] = sourceshared;
                return sourceshared;
            }
        },

        getVertex: function(sourcevertex) {
            var elements = [sourcevertex.pos._x, sourcevertex.pos._y, sourcevertex.pos._z];
            var result = this.vertexfactory.lookupOrCreate(elements, function(els) {
                return sourcevertex;
            });
            return result;
        },

        getPlane: function(sourceplane) {
            var elements = [sourceplane.normal._x, sourceplane.normal._y, sourceplane.normal._z, sourceplane.w];
            var result = this.planefactory.lookupOrCreate(elements, function(els) {
                return sourceplane;
            });
            return result;
        },

        getPolygon: function(sourcepolygon) {
            var newplane = this.getPlane(sourcepolygon.plane);
            var newshared = this.getPolygonShared(sourcepolygon.shared);
            var _this = this;
            var newvertices = sourcepolygon.vertices.map(function(vertex) {
                return _this.getVertex(vertex);
            });
            // two vertices that were originally very close may now have become
            // truly identical (referring to the same CSG.Vertex object).
            // Remove duplicate vertices:
            var newvertices_dedup = [];
            if(newvertices.length > 0) {
                var prevvertextag = newvertices[newvertices.length-1].getTag();
                newvertices.forEach(function(vertex) {
                    var vertextag = vertex.getTag();
                    if(vertextag != prevvertextag)
                    {
                        newvertices_dedup.push(vertex);
                    }
                    prevvertextag = vertextag;
                });
            }
            // If it's degenerate, remove all vertices:
            if(newvertices_dedup.length < 3) {
                newvertices_dedup = [];
            }
            return new CSG.Polygon(newvertices_dedup, newshared, newplane);
        },

        getCSG: function(sourcecsg) {
            var _this = this;
            var newpolygons = [];
            sourcecsg.polygons.forEach(function(polygon) {
                var newpolygon = _this.getPolygon(polygon);
                // see getPolygon above: we may get a polygon with no vertices, discard it:
                if(newpolygon.vertices.length >= 3)
                {
                    newpolygons.push(newpolygon);
                }
            });
            return CSG.fromPolygons(newpolygons);
        }
    };

    //////////////////////////////////////
    // Tag factory: we can request a unique tag through CSG.getTag()
    CSG.staticTag = 1;

    CSG.getTag = function() {
        return CSG.staticTag++;
    };

    //////////////////////////////////////
    // # Class Properties
    // This class is used to store properties of a solid
    // A property can for example be a CSG.Vertex, a CSG.Plane or a CSG.Line3D
    // Whenever an affine transform is applied to the CSG solid, all its properties are
    // transformed as well.
    // The properties can be stored in a complex nested structure (using arrays and objects)
    CSG.Properties = function() {};

    CSG.Properties.prototype = {
        _transform: function(matrix4x4) {
            var result = new CSG.Properties();
            CSG.Properties.transformObj(this, result, matrix4x4);
            return result;
        },
        _merge: function(otherproperties) {
            var result = new CSG.Properties();
            CSG.Properties.cloneObj(this, result);
            CSG.Properties.addFrom(result, otherproperties);
            return result;
        }
    };

    CSG.Properties.transformObj = function(source, result, matrix4x4) {
        for (var propertyname in source) {
            if (propertyname == "_transform") continue;
            if (propertyname == "_merge") continue;
            var propertyvalue = source[propertyname];
            var transformed = propertyvalue;
            if (typeof(propertyvalue) == "object") {
                if (('transform' in propertyvalue) && (typeof(propertyvalue.transform) == "function")) {
                    transformed = propertyvalue.transform(matrix4x4);
                } else if (propertyvalue instanceof Array) {
                    transformed = [];
                    CSG.Properties.transformObj(propertyvalue, transformed, matrix4x4);
                } else if (propertyvalue instanceof CSG.Properties) {
                    transformed = new CSG.Properties();
                    CSG.Properties.transformObj(propertyvalue, transformed, matrix4x4);
                }
            }
            result[propertyname] = transformed;
        }
    };

    CSG.Properties.cloneObj = function(source, result) {
        for (var propertyname in source) {
            if (propertyname == "_transform") continue;
            if (propertyname == "_merge") continue;
            var propertyvalue = source[propertyname];
            var cloned = propertyvalue;
            if (typeof(propertyvalue) == "object") {
                if (propertyvalue instanceof Array) {
                    cloned = [];
                    for (var i = 0; i < propertyvalue.length; i++) {
                        cloned.push(propertyvalue[i]);
                    }
                } else if (propertyvalue instanceof CSG.Properties) {
                    cloned = new CSG.Properties();
                    CSG.Properties.cloneObj(propertyvalue, cloned);
                }
            }
            result[propertyname] = cloned;
        }
    };

    CSG.Properties.addFrom = function(result, otherproperties) {
        for (var propertyname in otherproperties) {
            if (propertyname == "_transform") continue;
            if (propertyname == "_merge") continue;
            if ((propertyname in result) &&
                (typeof(result[propertyname]) == "object") &&
                (result[propertyname] instanceof CSG.Properties) &&
                (typeof(otherproperties[propertyname]) == "object") &&
                (otherproperties[propertyname] instanceof CSG.Properties)) {
                CSG.Properties.addFrom(result[propertyname], otherproperties[propertyname]);
            } else if (!(propertyname in result)) {
                result[propertyname] = otherproperties[propertyname];
            }
        }
    };

    //////////////////////////////////////
    // # class Connector
    // A connector allows to attach two objects at predefined positions
    // For example a servo motor and a servo horn:
    // Both can have a Connector called 'shaft'
    // The horn can be moved and rotated such that the two connectors match
    // and the horn is attached to the servo motor at the proper position.
    // Connectors are stored in the properties of a CSG solid so they are
    // ge the same transformations applied as the solid
    CSG.Connector = function(point, axisvector, normalvector) {
        this.point = new CSG.Vector3D(point);
        this.axisvector = new CSG.Vector3D(axisvector).unit();
        this.normalvector = new CSG.Vector3D(normalvector).unit();
    };

    CSG.Connector.prototype = {
        normalized: function() {
            var axisvector = this.axisvector.unit();
            // make the normal vector truly normal:
            var n = this.normalvector.cross(axisvector).unit();
            var normalvector = axisvector.cross(n);
            return new CSG.Connector(this.point, axisvector, normalvector);
        },

        transform: function(matrix4x4) {
            var point = this.point.multiply4x4(matrix4x4);
            var axisvector = this.point.plus(this.axisvector).multiply4x4(matrix4x4).minus(point);
            var normalvector = this.point.plus(this.normalvector).multiply4x4(matrix4x4).minus(point);
            return new CSG.Connector(point, axisvector, normalvector);
        },

        // Get the transformation matrix to connect this Connector to another connector
        //   other: a CSG.Connector to which this connector should be connected
        //   mirror: false: the 'axis' vectors of the connectors should point in the same direction
        //           true: the 'axis' vectors of the connectors should point in opposite direction
        //   normalrotation: degrees of rotation between the 'normal' vectors of the two
        //                   connectors
        getTransformationTo: function(other, mirror, normalrotation) {
            mirror = mirror ? true : false;
            normalrotation = normalrotation ? Number(normalrotation) : 0;
            var us = this.normalized();
            other = other.normalized();
            // shift to the origin:
            var transformation = CSG.Matrix4x4.translation(this.point.negated());
            // construct the plane crossing through the origin and the two axes:
            var axesplane = CSG.Plane.anyPlaneFromVector3Ds(
                new CSG.Vector3D(0, 0, 0), us.axisvector, other.axisvector);
            var axesbasis = new CSG.OrthoNormalBasis(axesplane);
            var angle1 = axesbasis.to2D(us.axisvector).angle();
            var angle2 = axesbasis.to2D(other.axisvector).angle();
            var rotation = 180.0 * (angle2 - angle1) / Math.PI;
            if (mirror) rotation += 180.0;
            transformation = transformation.multiply(axesbasis.getProjectionMatrix());
            transformation = transformation.multiply(CSG.Matrix4x4.rotationZ(rotation));
            transformation = transformation.multiply(axesbasis.getInverseProjectionMatrix());
            var usAxesAligned = us.transform(transformation);
            // Now we have done the transformation for aligning the axes.
            // We still need to align the normals:
            var normalsplane = CSG.Plane.fromNormalAndPoint(other.axisvector, new CSG.Vector3D(0, 0, 0));
            var normalsbasis = new CSG.OrthoNormalBasis(normalsplane);
            angle1 = normalsbasis.to2D(usAxesAligned.normalvector).angle();
            angle2 = normalsbasis.to2D(other.normalvector).angle();
            rotation = 180.0 * (angle2 - angle1) / Math.PI;
            rotation += normalrotation;
            transformation = transformation.multiply(normalsbasis.getProjectionMatrix());
            transformation = transformation.multiply(CSG.Matrix4x4.rotationZ(rotation));
            transformation = transformation.multiply(normalsbasis.getInverseProjectionMatrix());
            // and translate to the destination point:
            transformation = transformation.multiply(CSG.Matrix4x4.translation(other.point));
            // var usAligned = us.transform(transformation);
            return transformation;
        },

        axisLine: function() {
            return new CSG.Line3D(this.point, this.axisvector);
        },

        // creates a new Connector, with the connection point moved in the direction of the axisvector
        extend: function(distance) {
            var newpoint = this.point.plus(this.axisvector.unit().times(distance));
            return new CSG.Connector(newpoint, this.axisvector, this.normalvector);
        }
    };

    CSG.ConnectorList = function(connectors) {
        this.connectors_ = connectors ? connectors.slice() : [];
    };

    CSG.ConnectorList.defaultNormal = [0, 0, 1];

    CSG.ConnectorList.fromPath2D = function(path2D, arg1, arg2) {
        if (arguments.length === 3) {
            return CSG.ConnectorList._fromPath2DTangents(path2D, arg1, arg2);
        } else if (arguments.length == 2) {
            return CSG.ConnectorList._fromPath2DExplicit(path2D, arg1);
        } else {
            throw("call with path2D and either 2 direction vectors, or a function returning direction vectors");
        }
    };

    /*
     * calculate the connector axisvectors by calculating the "tangent" for path2D.
     * This is undefined for start and end points, so axis for these have to be manually
     * provided.
     */
    CSG.ConnectorList._fromPath2DTangents = function(path2D, start, end) {
        // path2D
        var axis;
        var pathLen = path2D.points.length;
        var result = new CSG.ConnectorList([new CSG.Connector(path2D.points[0],
            start, CSG.ConnectorList.defaultNormal)]);
        // middle points
        path2D.points.slice(1, pathLen - 1).forEach(function(p2, i) {
            axis = path2D.points[i + 2].minus(path2D.points[i]).toVector3D(0);
            result.appendConnector(new CSG.Connector(p2.toVector3D(0), axis,
              CSG.ConnectorList.defaultNormal));
        }, this);
        result.appendConnector(new CSG.Connector(path2D.points[pathLen - 1], end,
          CSG.ConnectorList.defaultNormal));
        result.closed = path2D.closed;
        return result;
    };

    /*
     * angleIsh: either a static angle, or a function(point) returning an angle
     */
    CSG.ConnectorList._fromPath2DExplicit = function(path2D, angleIsh) {
        function getAngle(angleIsh, pt, i) {
            if (typeof angleIsh == 'function') {
                angleIsh = angleIsh(pt, i);
            }
            return angleIsh;
        }
        var result = new CSG.ConnectorList(
            path2D.points.map(function(p2, i) {
                return new CSG.Connector(p2.toVector3D(0),
                    CSG.Vector3D.Create(1, 0, 0).rotateZ(getAngle(angleIsh, p2, i)),
                      CSG.ConnectorList.defaultNormal);
            }, this)
        );
        result.closed = path2D.closed;
        return result;
    };


    CSG.ConnectorList.prototype = {
        setClosed: function(bool) {
            this.closed = !!closed;
        },
        appendConnector: function(conn) {
            this.connectors_.push(conn);
        },
        /*
         * arguments: cagish: a cag or a function(connector) returning a cag
         *            closed: whether the 3d path defined by connectors location
         *              should be closed or stay open
         *              Note: don't duplicate connectors in the path
         * TODO: consider an option "maySelfIntersect" to close & force union all single segments
         */
        followWith: function(cagish) {
            this.verify();
            function getCag(cagish, connector) {
                if (typeof cagish == "function") {
                    cagish = cagish(connector.point, connector.axisvector, connector.normalvector);
                }
                return cagish;
            }

            var polygons = [], currCag;
            var prevConnector = this.connectors_[this.connectors_.length - 1];
            var prevCag = getCag(cagish, prevConnector);
            // add walls
            this.connectors_.forEach(function(connector, notFirst) {
                currCag = getCag(cagish, connector);
                if (notFirst || this.closed) {
                    polygons.push.apply(polygons, prevCag._toWallPolygons({
                        toConnector1: prevConnector, toConnector2: connector, cag: currCag}));
                } else {
                    // it is the first, and shape not closed -> build start wall
                    polygons.push.apply(polygons,
                        currCag._toPlanePolygons({toConnector: connector, flipped: true}));
                }
                if (notFirst == this.connectors_.length - 1 && !this.closed) {
                    // build end wall
                    polygons.push.apply(polygons,
                        currCag._toPlanePolygons({toConnector: connector}));
                }
                prevCag = currCag;
                prevConnector = connector;
            }, this);
            return CSG.fromPolygons(polygons).reTesselated().canonicalized();
        },
        /*
         * general idea behind these checks: connectors need to have smooth transition from one to another
         * TODO: add a check that 2 follow-on CAGs are not intersecting
         */
        verify: function() {
            var connI, connI1, dPosToAxis, axisToNextAxis;
            for (var i = 0; i < this.connectors_.length - 1; i++) {
                connI = this.connectors_[i], connI1 = this.connectors_[i + 1];
                if (connI1.point.minus(connI.point).dot(connI.axisvector) <= 0) {
                    throw("Invalid ConnectorList. Each connectors position needs to be within a <90deg range of previous connectors axisvector");
                }
                if (connI.axisvector.dot(connI1.axisvector) <= 0) {
                    throw("invalid ConnectorList. No neighboring connectors axisvectors may span a >=90deg angle");
                }
            }
        }
    };

    //////////////////////////////////////
    // # Class Path2D
    CSG.Path2D = function(points, closed) {
        closed = !!closed;
        points = points || [];
        // re-parse the points into CSG.Vector2D
        // and remove any duplicate points
        var prevpoint = null;
        if (closed && (points.length > 0)) {
            prevpoint = new CSG.Vector2D(points[points.length - 1]);
        }
        var newpoints = [];
        points.map(function(point) {
            point = new CSG.Vector2D(point);
            var skip = false;
            if (prevpoint !== null) {
                var distance = point.distanceTo(prevpoint);
                skip = distance < 1e-5;
            }
            if (!skip) newpoints.push(point);
            prevpoint = point;
        });
        this.points = newpoints;
        this.closed = closed;
    };

    /*
    Construct a (part of a) circle. Parameters:
      options.center: the center point of the arc (CSG.Vector2D or array [x,y])
      options.radius: the circle radius (float)
      options.startangle: the starting angle of the arc, in degrees
        0 degrees corresponds to [1,0]
        90 degrees to [0,1]
        and so on
      options.endangle: the ending angle of the arc, in degrees
      options.resolution: number of points per 360 degree of rotation
      options.maketangent: adds two extra tiny line segments at both ends of the circle
        this ensures that the gradients at the edges are tangent to the circle
    Returns a CSG.Path2D. The path is not closed (even if it is a 360 degree arc).
    close() the resulting path if you want to create a true circle.
    */
    CSG.Path2D.arc = function(options) {
        var center = CSG.parseOptionAs2DVector(options, "center", 0);
        var radius = CSG.parseOptionAsFloat(options, "radius", 1);
        var startangle = CSG.parseOptionAsFloat(options, "startangle", 0);
        var endangle = CSG.parseOptionAsFloat(options, "endangle", 360);
        var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution2D);
        var maketangent = CSG.parseOptionAsBool(options, "maketangent", false);
        // no need to make multiple turns:
        while (endangle - startangle >= 720) {
            endangle -= 360;
        }
        while (endangle - startangle <= -720) {
            endangle += 360;
        }
        var points = [],
            point;
        var absangledif = Math.abs(endangle - startangle);
        if (absangledif < 1e-5) {
            point = CSG.Vector2D.fromAngle(startangle / 180.0 * Math.PI).times(radius);
            points.push(point.plus(center));
        } else {
            var numsteps = Math.floor(resolution * absangledif / 360) + 1;
            var edgestepsize = numsteps * 0.5 / absangledif; // step size for half a degree
            if (edgestepsize > 0.25) edgestepsize = 0.25;
            var numsteps_mod = maketangent ? (numsteps + 2) : numsteps;
            for (var i = 0; i <= numsteps_mod; i++) {
                var step = i;
                if (maketangent) {
                    step = (i - 1) * (numsteps - 2 * edgestepsize) / numsteps + edgestepsize;
                    if (step < 0) step = 0;
                    if (step > numsteps) step = numsteps;
                }
                var angle = startangle + step * (endangle - startangle) / numsteps;
                point = CSG.Vector2D.fromAngle(angle / 180.0 * Math.PI).times(radius);
                points.push(point.plus(center));
            }
        }
        return new CSG.Path2D(points, false);
    };

    CSG.Path2D.prototype = {
        concat: function(otherpath) {
            if (this.closed || otherpath.closed) {
                throw new Error("Paths must not be closed");
            }
            var newpoints = this.points.concat(otherpath.points);
            return new CSG.Path2D(newpoints);
        },

        appendPoint: function(point) {
            if (this.closed) {
                throw new Error("Path must not be closed");
            }
            point = new CSG.Vector2D(point); // cast to Vector2D
            var newpoints = this.points.concat([point]);
            return new CSG.Path2D(newpoints);
        },

        appendPoints: function(points) {
            if (this.closed) {
                throw new Error("Path must not be closed");
            }
            var newpoints = this.points;
            points.forEach(function(point) {
                newpoints.push(new CSG.Vector2D(point)); // cast to Vector2D
            })
            return new CSG.Path2D(newpoints);
        },

        close: function() {
            return new CSG.Path2D(this.points, true);
        },

        // Extrude the path by following it with a rectangle (upright, perpendicular to the path direction)
        // Returns a CSG solid
        //   width: width of the extrusion, in the z=0 plane
        //   height: height of the extrusion in the z direction
        //   resolution: number of segments per 360 degrees for the curve in a corner
        rectangularExtrude: function(width, height, resolution) {
            var cag = this.expandToCAG(width / 2, resolution);
            var result = cag.extrude({
                offset: [0, 0, height]
            });
            return result;
        },

        // Expand the path to a CAG
        // This traces the path with a circle with radius pathradius
        expandToCAG: function(pathradius, resolution) {
            var sides = [];
            var numpoints = this.points.length;
            var startindex = 0;
            if (this.closed && (numpoints > 2)) startindex = -1;
            var prevvertex;
            for (var i = startindex; i < numpoints; i++) {
                var pointindex = i;
                if (pointindex < 0) pointindex = numpoints - 1;
                var point = this.points[pointindex];
                var vertex = new CAG.Vertex(point);
                if (i > startindex) {
                    var side = new CAG.Side(prevvertex, vertex);
                    sides.push(side);
                }
                prevvertex = vertex;
            }
            var shellcag = CAG.fromSides(sides);
            var expanded = shellcag.expandedShell(pathradius, resolution);
            return expanded;
        },

        innerToCAG: function() {
            if (!this.closed) throw new Error("The path should be closed!");
            return CAG.fromPoints(this.points);
        },

        transform: function(matrix4x4) {
            var newpoints = this.points.map(function(point) {
                return point.multiply4x4(matrix4x4);
            });
            return new CSG.Path2D(newpoints, this.closed);
        },

        appendBezier: function(controlpoints, options) {
            if (arguments.length < 2) {
                options = {};
            }
            if (this.closed) {
                throw new Error("Path must not be closed");
            }
            if (!(controlpoints instanceof Array)) {
                throw new Error("appendBezier: should pass an array of control points")
            }
            if (controlpoints.length < 1) {
                throw new Error("appendBezier: need at least 1 control point")
            }
            if (this.points.length < 1) {
                throw new Error("appendBezier: path must already contain a point (the endpoint of the path is used as the starting point for the bezier curve)");
            }
            var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution2D);
            if (resolution < 4) resolution = 4;
            var factorials = [];
            var controlpoints_parsed = [];
            controlpoints_parsed.push(this.points[this.points.length - 1]); // start at the previous end point
            for (var i = 0; i < controlpoints.length; ++i) {
                var p = controlpoints[i];
                if (p === null) {
                    // we can pass null as the first control point. In that case a smooth gradient is ensured:
                    if (i != 0) {
                        throw new Error("appendBezier: null can only be passed as the first control point");
                    }
                    if (controlpoints.length < 2) {
                        throw new Error("appendBezier: null can only be passed if there is at least one more control point");
                    }
                    var lastBezierControlPoint;
                    if ('lastBezierControlPoint' in this) {
                        lastBezierControlPoint = this.lastBezierControlPoint;
                    } else {
                        if (this.points.length < 2) {
                            throw new Error("appendBezier: null is passed as a control point but this requires a previous bezier curve or at least two points in the existing path");
                        }
                        lastBezierControlPoint = this.points[this.points.length - 2];
                    }
                    // mirror the last bezier control point:
                    p = this.points[this.points.length - 1].times(2).minus(lastBezierControlPoint);
                } else {
                    p = new CSG.Vector2D(p); // cast to Vector2D
                }
                controlpoints_parsed.push(p);
            }
            var bezier_order = controlpoints_parsed.length - 1;
            var fact = 1;
            for (var i = 0; i <= bezier_order; ++i) {
                if (i > 0) fact *= i;
                factorials.push(fact);
            }
            var binomials = [];
            for (var i = 0; i <= bezier_order; ++i) {
                var binomial = factorials[bezier_order] / (factorials[i] * factorials[bezier_order - i]);
                binomials.push(binomial);
            }
            var getPointForT = function(t) {
                var t_k = 1; // = pow(t,k)
                var one_minus_t_n_minus_k = Math.pow(1 - t, bezier_order); // = pow( 1-t, bezier_order - k)
                var inv_1_minus_t = (t != 1) ? (1 / (1 - t)) : 1;
                var point = new CSG.Vector2D(0, 0);
                for (var k = 0; k <= bezier_order; ++k) {
                    if (k == bezier_order) one_minus_t_n_minus_k = 1;
                    var bernstein_coefficient = binomials[k] * t_k * one_minus_t_n_minus_k;
                    point = point.plus(controlpoints_parsed[k].times(bernstein_coefficient));
                    t_k *= t;
                    one_minus_t_n_minus_k *= inv_1_minus_t;
                }
                return point;
            };
            var newpoints = [];
            var newpoints_t = [];
            var numsteps = bezier_order + 1;
            for (var i = 0; i < numsteps; ++i) {
                var t = i / (numsteps - 1);
                var point = getPointForT(t);
                newpoints.push(point);
                newpoints_t.push(t);
            }
            // subdivide each segment until the angle at each vertex becomes small enough:
            var subdivide_base = 1;
            var maxangle = Math.PI * 2 / resolution; // segments may have differ no more in angle than this
            var maxsinangle = Math.sin(maxangle);
            while (subdivide_base < newpoints.length - 1) {
                var dir1 = newpoints[subdivide_base].minus(newpoints[subdivide_base - 1]).unit();
                var dir2 = newpoints[subdivide_base + 1].minus(newpoints[subdivide_base]).unit();
                var sinangle = dir1.cross(dir2); // this is the sine of the angle
                if (Math.abs(sinangle) > maxsinangle) {
                    // angle is too big, we need to subdivide
                    var t0 = newpoints_t[subdivide_base - 1];
                    var t1 = newpoints_t[subdivide_base + 1];
                    var t0_new = t0 + (t1 - t0) * 1 / 3;
                    var t1_new = t0 + (t1 - t0) * 2 / 3;
                    var point0_new = getPointForT(t0_new);
                    var point1_new = getPointForT(t1_new);
                    // remove the point at subdivide_base and replace with 2 new points:
                    newpoints.splice(subdivide_base, 1, point0_new, point1_new);
                    newpoints_t.splice(subdivide_base, 1, t0_new, t1_new);
                    // re - evaluate the angles, starting at the previous junction since it has changed:
                    subdivide_base--;
                    if (subdivide_base < 1) subdivide_base = 1;
                } else {
                    ++subdivide_base;
                }
            }
            // append to the previous points, but skip the first new point because it is identical to the last point:
            newpoints = this.points.concat(newpoints.slice(1));
            var result = new CSG.Path2D(newpoints);
            result.lastBezierControlPoint = controlpoints_parsed[controlpoints_parsed.length - 2];
            return result;
        },

        /*
         options:
         .resolution // smoothness of the arc (number of segments per 360 degree of rotation)
         // to create a circular arc:
         .radius
         // to create an elliptical arc:
         .xradius
         .yradius
         .xaxisrotation  // the rotation (in degrees) of the x axis of the ellipse with respect to the x axis of our coordinate system
         // this still leaves 4 possible arcs between the two given points. The following two flags select which one we draw:
         .clockwise // = true | false (default is false). Two of the 4 solutions draw clockwise with respect to the center point, the other 2 counterclockwise
         .large     // = true | false (default is false). Two of the 4 solutions are an arc longer than 180 degrees, the other two are <= 180 degrees
         This implementation follows the SVG arc specs. For the details see
         http://www.w3.org/TR/SVG/paths.html#PathDataEllipticalArcCommands
         */
        appendArc: function(endpoint, options) {
            var decimals = 100000;
            if (arguments.length < 2) {
                options = {};
            }
            if (this.closed) {
                throw new Error("Path must not be closed");
            }
            if (this.points.length < 1) {
                throw new Error("appendArc: path must already contain a point (the endpoint of the path is used as the starting point for the arc)");
            }
            var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution2D);
            if (resolution < 4) resolution = 4;
            var xradius, yradius;
            if (('xradius' in options) || ('yradius' in options)) {
                if ('radius' in options) {
                    throw new Error("Should either give an xradius and yradius parameter, or a radius parameter");
                }
                xradius = CSG.parseOptionAsFloat(options, "xradius", 0);
                yradius = CSG.parseOptionAsFloat(options, "yradius", 0);
            } else {
                xradius = CSG.parseOptionAsFloat(options, "radius", 0);
                yradius = xradius;
            }
            var xaxisrotation = CSG.parseOptionAsFloat(options, "xaxisrotation", 0);
            var clockwise = CSG.parseOptionAsBool(options, "clockwise", false);
            var largearc = CSG.parseOptionAsBool(options, "large", false);
            var startpoint = this.points[this.points.length - 1];
            endpoint = new CSG.Vector2D(endpoint);
            // round to precision in order to have determinate calculations
            xradius = Math.round(xradius*decimals)/decimals;
            yradius = Math.round(yradius*decimals)/decimals;
            endpoint = new CSG.Vector2D(Math.round(endpoint.x*decimals)/decimals,Math.round(endpoint.y*decimals)/decimals);

            var sweep_flag = !clockwise;
            var newpoints = [];
            if ((xradius == 0) || (yradius == 0)) {
                // http://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes:
                // If rx = 0 or ry = 0, then treat this as a straight line from (x1, y1) to (x2, y2) and stop
                newpoints.push(endpoint);
            } else {
                xradius = Math.abs(xradius);
                yradius = Math.abs(yradius);

                // see http://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes :
                var phi = xaxisrotation * Math.PI / 180.0;
                var cosphi = Math.cos(phi);
                var sinphi = Math.sin(phi);
                var minushalfdistance = startpoint.minus(endpoint).times(0.5);
                // F.6.5.1:
                // round to precision in order to have determinate calculations
                var x = Math.round((cosphi * minushalfdistance.x + sinphi * minushalfdistance.y)*decimals)/decimals;
                var y = Math.round((-sinphi * minushalfdistance.x + cosphi * minushalfdistance.y)*decimals)/decimals;
                var start_translated = new CSG.Vector2D(x,y);
                // F.6.6.2:
                var biglambda = (start_translated.x * start_translated.x) / (xradius * xradius) + (start_translated.y * start_translated.y) / (yradius * yradius);
                if (biglambda > 1.0) {
                    // F.6.6.3:
                    var sqrtbiglambda = Math.sqrt(biglambda);
                    xradius *= sqrtbiglambda;
                    yradius *= sqrtbiglambda;
                    // round to precision in order to have determinate calculations
                    xradius = Math.round(xradius*decimals)/decimals;
                    yradius = Math.round(yradius*decimals)/decimals;
                }
                // F.6.5.2:
                var multiplier1 = Math.sqrt((xradius * xradius * yradius * yradius - xradius * xradius * start_translated.y * start_translated.y - yradius * yradius * start_translated.x * start_translated.x) / (xradius * xradius * start_translated.y * start_translated.y + yradius * yradius * start_translated.x * start_translated.x));
                if (sweep_flag == largearc) multiplier1 = -multiplier1;
                var center_translated = new CSG.Vector2D(xradius * start_translated.y / yradius, -yradius * start_translated.x / xradius).times(multiplier1);
                // F.6.5.3:
                var center = new CSG.Vector2D(cosphi * center_translated.x - sinphi * center_translated.y, sinphi * center_translated.x + cosphi * center_translated.y).plus((startpoint.plus(endpoint)).times(0.5));
                // F.6.5.5:
                var vec1 = new CSG.Vector2D((start_translated.x - center_translated.x) / xradius, (start_translated.y - center_translated.y) / yradius);
                var vec2 = new CSG.Vector2D((-start_translated.x - center_translated.x) / xradius, (-start_translated.y - center_translated.y) / yradius);
                var theta1 = vec1.angleRadians();
                var theta2 = vec2.angleRadians();
                var deltatheta = theta2 - theta1;
                deltatheta = deltatheta % (2 * Math.PI);
                if ((!sweep_flag) && (deltatheta > 0)) {
                    deltatheta -= 2 * Math.PI;
                } else if ((sweep_flag) && (deltatheta < 0)) {
                    deltatheta += 2 * Math.PI;
                }

                // Ok, we have the center point and angle range (from theta1, deltatheta radians) so we can create the ellipse
                var numsteps = Math.ceil(Math.abs(deltatheta) / (2 * Math.PI) * resolution) + 1;
                if (numsteps < 1) numsteps = 1;
                for (var step = 1; step <= numsteps; step++) {
                    var theta = theta1 + step / numsteps * deltatheta;
                    var costheta = Math.cos(theta);
                    var sintheta = Math.sin(theta);
                    // F.6.3.1:
                    var point = new CSG.Vector2D(cosphi * xradius * costheta - sinphi * yradius * sintheta, sinphi * xradius * costheta + cosphi * yradius * sintheta).plus(center);
                    newpoints.push(point);
                }
            }
            newpoints = this.points.concat(newpoints);
            var result = new CSG.Path2D(newpoints);
            return result;
        },
    };

    // Add several convenience methods to the classes that support a transform() method:
    CSG.addTransformationMethodsToPrototype = function(prot) {
        prot.mirrored = function(plane) {
            return this.transform(CSG.Matrix4x4.mirroring(plane));
        };

        prot.mirroredX = function() {
            var plane = new CSG.Plane(CSG.Vector3D.Create(1, 0, 0), 0);
            return this.mirrored(plane);
        };

        prot.mirroredY = function() {
            var plane = new CSG.Plane(CSG.Vector3D.Create(0, 1, 0), 0);
            return this.mirrored(plane);
        };

        prot.mirroredZ = function() {
            var plane = new CSG.Plane(CSG.Vector3D.Create(0, 0, 1), 0);
            return this.mirrored(plane);
        };

        prot.translate = function(v) {
            return this.transform(CSG.Matrix4x4.translation(v));
        };

        prot.scale = function(f) {
            return this.transform(CSG.Matrix4x4.scaling(f));
        };

        prot.rotateX = function(deg) {
            return this.transform(CSG.Matrix4x4.rotationX(deg));
        };

        prot.rotateY = function(deg) {
            return this.transform(CSG.Matrix4x4.rotationY(deg));
        };

        prot.rotateZ = function(deg) {
            return this.transform(CSG.Matrix4x4.rotationZ(deg));
        };

        prot.rotate = function(rotationCenter, rotationAxis, degrees) {
            return this.transform(CSG.Matrix4x4.rotation(rotationCenter, rotationAxis, degrees));
        };

        prot.rotateEulerAngles = function(alpha, beta, gamma, position) {
            position = position || [0,0,0];

            var Rz1 = CSG.Matrix4x4.rotationZ(alpha);
            var Rx  = CSG.Matrix4x4.rotationX(beta);
            var Rz2 = CSG.Matrix4x4.rotationZ(gamma);
            var T   = CSG.Matrix4x4.translation(new CSG.Vector3D(position));

            return this.transform(Rz2.multiply(Rx).multiply(Rz1).multiply(T));
        };
    };

    // TODO: consider generalization and adding to addTransformationMethodsToPrototype
    CSG.addCenteringToPrototype = function(prot, axes) {
        prot.center = function(cAxes) {
            cAxes = Array.prototype.map.call(arguments, function(a) {
                return a; //.toLowerCase();
            });
            // no args: center on all axes
            if (!cAxes.length) {
                cAxes = axes.slice();
            }
            var b = this.getBounds();
            return this.translate(axes.map(function(a) {
                return cAxes.indexOf(a) > -1 ?
                    -(b[0][a] + b[1][a])/2 : 0;
            }));
        };
    };

    //////////////////
    // CAG: solid area geometry: like CSG but 2D
    // Each area consists of a number of sides
    // Each side is a line between 2 points
    var CAG = function() {
        this.sides = [];
        this.isCanonicalized = false;
    };

    // create from an untyped object with identical property names:
    CAG.fromObject = function(obj) {
        var sides = obj.sides.map(function(s) {
            return CAG.Side.fromObject(s);
        });
        var cag = CAG.fromSides(sides);
        return cag;
    }

    // Construct a CAG from a list of `CAG.Side` instances.
    CAG.fromSides = function(sides) {
        var cag = new CAG();
        cag.sides = sides;
        return cag;
    };

    // Construct a CAG from a list of points (a polygon)
    // Rotation direction of the points is not relevant. Points can be a convex or concave polygon.
    // Polygon must not self intersect
    CAG.fromPoints = function(points) {
        var numpoints = points.length;
        if (numpoints < 3) throw new Error("CAG shape needs at least 3 points");
        var sides = [];
        var prevpoint = new CSG.Vector2D(points[numpoints - 1]);
        var prevvertex = new CAG.Vertex(prevpoint);
        points.map(function(p) {
            var point = new CSG.Vector2D(p);
            var vertex = new CAG.Vertex(point);
            var side = new CAG.Side(prevvertex, vertex);
            sides.push(side);
            prevvertex = vertex;
        });
        var result = CAG.fromSides(sides);
        if (result.isSelfIntersecting()) {
            throw new Error("Polygon is self intersecting!");
        }
        var area = result.area();
        if (Math.abs(area) < 1e-5) {
            throw new Error("Degenerate polygon!");
        }
        if (area < 0) {
            result = result.flipped();
        }
        result = result.canonicalized();
        return result;
    };

    // Like CAG.fromPoints but does not check if it's a valid polygon.
    // Points should rotate counter clockwise
    CAG.fromPointsNoCheck = function(points) {
        var sides = [];
        var prevpoint = new CSG.Vector2D(points[points.length - 1]);
        var prevvertex = new CAG.Vertex(prevpoint);
        points.map(function(p) {
            var point = new CSG.Vector2D(p);
            var vertex = new CAG.Vertex(point);
            var side = new CAG.Side(prevvertex, vertex);
            sides.push(side);
            prevvertex = vertex;
        });
        return CAG.fromSides(sides);
    };

    // Converts a CSG to a CAG. The CSG must consist of polygons with only z coordinates +1 and -1
    // as constructed by CAG._toCSGWall(-1, 1). This is so we can use the 3D union(), intersect() etc
    CAG.fromFakeCSG = function(csg) {
        var sides = csg.polygons.map(function(p) {
            return CAG.Side._fromFakePolygon(p);
            })
            .filter(function(s) {
                return s !== null;
        });
        return CAG.fromSides(sides);
    };

    // see if the line between p0start and p0end intersects with the line between p1start and p1end
    // returns true if the lines strictly intersect, the end points are not counted!
    CAG.linesIntersect = function(p0start, p0end, p1start, p1end) {
        if (p0end.equals(p1start) || p1end.equals(p0start)) {
            var d = p1end.minus(p1start).unit().plus(p0end.minus(p0start).unit()).length();
            if (d < 1e-5) {
                return true;
            }
        } else {
            var d0 = p0end.minus(p0start);
            var d1 = p1end.minus(p1start);
            if (Math.abs(d0.cross(d1)) < 1e-9) return false; // lines are parallel
            var alphas = CSG.solve2Linear(-d0.x, d1.x, -d0.y, d1.y, p0start.x - p1start.x, p0start.y - p1start.y);
            if ((alphas[0] > 1e-6) && (alphas[0] < 0.999999) && (alphas[1] > 1e-5) && (alphas[1] < 0.999999)) return true;
            //    if( (alphas[0] >= 0) && (alphas[0] <= 1) && (alphas[1] >= 0) && (alphas[1] <= 1) ) return true;
        }
        return false;
    };

    /* Construct a circle
    options:
      center: a 2D center point
      radius: a scalar
      resolution: number of sides per 360 degree rotation
    returns a CAG object
    */
    CAG.circle = function(options) {
        options = options || {};
        var center = CSG.parseOptionAs2DVector(options, "center", [0, 0]);
        var radius = CSG.parseOptionAsFloat(options, "radius", 1);
        var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution2D);
        var sides = [];
        var prevvertex;
        for (var i = 0; i <= resolution; i++) {
            var radians = 2 * Math.PI * i / resolution;
            var point = CSG.Vector2D.fromAngleRadians(radians).times(radius).plus(center);
            var vertex = new CAG.Vertex(point);
            if (i > 0) {
                sides.push(new CAG.Side(prevvertex, vertex));
            }
            prevvertex = vertex;
        }
        return CAG.fromSides(sides);
    };

    /* Construct an ellispe
    options:
      center: a 2D center point
      radius: a 2D vector with width and height
      resolution: number of sides per 360 degree rotation
    returns a CAG object
    */
    CAG.ellipse = function(options) {
        options = options || {};
        var c = CSG.parseOptionAs2DVector(options, "center", [0, 0]);
        var r = CSG.parseOptionAs2DVector(options, "radius", [1, 1]);
        r = r.abs(); // negative radii make no sense
        var res = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution2D);

        var e2 = new CSG.Path2D([[c.x,c.y + r.y]]);
        e2 = e2.appendArc([c.x,c.y - r.y], {
            xradius: r.x,
            yradius: r.y,
            xaxisrotation: 0,
            resolution: res,
            clockwise: true,
            large: false,
        });
        e2 = e2.appendArc([c.x,c.y + r.y], {
            xradius: r.x,
            yradius: r.y,
            xaxisrotation: 0,
            resolution: res,
            clockwise: true,
            large: false,
        });
        e2 = e2.close();
        return e2.innerToCAG();
    };

    /* Construct a rectangle
    options:
      center: a 2D center point
      radius: a 2D vector with width and height
      returns a CAG object
    */
    CAG.rectangle = function(options) {
        options = options || {};
        var c, r;
        if (('corner1' in options) || ('corner2' in options)) {
            if (('center' in options) || ('radius' in options)) {
                throw new Error("rectangle: should either give a radius and center parameter, or a corner1 and corner2 parameter")
            }
            corner1 = CSG.parseOptionAs2DVector(options, "corner1", [0, 0]);
            corner2 = CSG.parseOptionAs2DVector(options, "corner2", [1, 1]);
            c = corner1.plus(corner2).times(0.5);
            r = corner2.minus(corner1).times(0.5);
        } else {
            c = CSG.parseOptionAs2DVector(options, "center", [0, 0]);
            r = CSG.parseOptionAs2DVector(options, "radius", [1, 1]);
        }
        r = r.abs(); // negative radii make no sense
        var rswap = new CSG.Vector2D(r.x, -r.y);
        var points = [
            c.plus(r), c.plus(rswap), c.minus(r), c.minus(rswap)
        ];
        return CAG.fromPoints(points);
    };

    //     var r = CSG.roundedRectangle({
    //       center: [0, 0],
    //       radius: [2, 1],
    //       roundradius: 0.2,
    //       resolution: 8,
    //     });
    CAG.roundedRectangle = function(options) {
        options = options || {};
        var center, radius;
        if (('corner1' in options) || ('corner2' in options)) {
            if (('center' in options) || ('radius' in options)) {
                throw new Error("roundedRectangle: should either give a radius and center parameter, or a corner1 and corner2 parameter")
            }
            corner1 = CSG.parseOptionAs2DVector(options, "corner1", [0, 0]);
            corner2 = CSG.parseOptionAs2DVector(options, "corner2", [1, 1]);
            center = corner1.plus(corner2).times(0.5);
            radius = corner2.minus(corner1).times(0.5);
        } else {
            center = CSG.parseOptionAs2DVector(options, "center", [0, 0]);
            radius = CSG.parseOptionAs2DVector(options, "radius", [1, 1]);
        }
        radius = radius.abs(); // negative radii make no sense
        var roundradius = CSG.parseOptionAsFloat(options, "roundradius", 0.2);
        var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution2D);
        var maxroundradius = Math.min(radius.x, radius.y);
        maxroundradius -= 0.1;
        roundradius = Math.min(roundradius, maxroundradius);
        roundradius = Math.max(0, roundradius);
        radius = new CSG.Vector2D(radius.x - roundradius, radius.y - roundradius);
        var rect = CAG.rectangle({
            center: center,
            radius: radius
        });
        if (roundradius > 0) {
            rect = rect.expand(roundradius, resolution);
        }
        return rect;
    };

    // Reconstruct a CAG from the output of toCompactBinary()
    CAG.fromCompactBinary = function(bin) {
        if (bin['class'] != "CAG") throw new Error("Not a CAG");
        var vertices = [];
        var vertexData = bin.vertexData;
        var numvertices = vertexData.length / 2;
        var arrayindex = 0;
        for (var vertexindex = 0; vertexindex < numvertices; vertexindex++) {
            var x = vertexData[arrayindex++];
            var y = vertexData[arrayindex++];
            var pos = new CSG.Vector2D(x, y);
            var vertex = new CAG.Vertex(pos);
            vertices.push(vertex);
        }

        var sides = [];
        var numsides = bin.sideVertexIndices.length / 2;
        arrayindex = 0;
        for (var sideindex = 0; sideindex < numsides; sideindex++) {
            var vertexindex0 = bin.sideVertexIndices[arrayindex++];
            var vertexindex1 = bin.sideVertexIndices[arrayindex++];
            var side = new CAG.Side(vertices[vertexindex0], vertices[vertexindex1]);
            sides.push(side);
        }
        var cag = CAG.fromSides(sides);
        cag.isCanonicalized = true;
        return cag;
    };

    function fnSortByIndex(a, b) {
        return a.index - b.index;
    }

    CAG.prototype = {
        toString: function() {
            var result = "CAG (" + this.sides.length + " sides):\n";
            this.sides.map(function(side) {
                result += "  " + side.toString() + "\n";
            });
            return result;
        },

        _toCSGWall: function(z0, z1) {
            var polygons = this.sides.map(function(side) {
                return side.toPolygon3D(z0, z1);
            });
            return CSG.fromPolygons(polygons);
        },

        _toVector3DPairs: function(m) {
            // transform m
            var pairs = this.sides.map(function(side) {
                var p0 = side.vertex0.pos, p1 = side.vertex1.pos;
                return [CSG.Vector3D.Create(p0.x, p0.y, 0),
                    CSG.Vector3D.Create(p1.x, p1.y, 0)];
            });
            if (typeof m != 'undefined') {
                pairs = pairs.map(function(pair) {
                    return pair.map(function(v) {
                        return v.transform(m);
                    });
                });
            }
            return pairs;
        },

        /*
         * transform a cag into the polygons of a corresponding 3d plane, positioned per options
         * Accepts a connector for plane positioning, or optionally
         * single translation, axisVector, normalVector arguments
         * (toConnector has precedence over single arguments if provided)
         */
        _toPlanePolygons: function(options) {
            var flipped = options.flipped || false;
            // reference connector for transformation
            var origin = [0, 0, 0], defaultAxis = [0, 0, 1], defaultNormal = [0, 1, 0];
            var thisConnector = new CSG.Connector(origin, defaultAxis, defaultNormal);
            // translated connector per options
            var translation = options.translation || origin;
            var axisVector = options.axisVector || defaultAxis;
            var normalVector = options.normalVector || defaultNormal;
            // will override above if options has toConnector
            var toConnector = options.toConnector ||
                new CSG.Connector(translation, axisVector, normalVector);
            // resulting transform
            var m = thisConnector.getTransformationTo(toConnector, false, 0);
            // create plane as a (partial non-closed) CSG in XY plane
            var bounds = this.getBounds();
            bounds[0] = bounds[0].minus(new CSG.Vector2D(1, 1));
            bounds[1] = bounds[1].plus(new CSG.Vector2D(1, 1));
            var csgshell = this._toCSGWall(-1, 1);
            var csgplane = CSG.fromPolygons([new CSG.Polygon([
                new CSG.Vertex(new CSG.Vector3D(bounds[0].x, bounds[0].y, 0)),
                new CSG.Vertex(new CSG.Vector3D(bounds[1].x, bounds[0].y, 0)),
                new CSG.Vertex(new CSG.Vector3D(bounds[1].x, bounds[1].y, 0)),
                new CSG.Vertex(new CSG.Vector3D(bounds[0].x, bounds[1].y, 0))
            ])]);
            if (flipped) {
                csgplane = csgplane.invert();
            }
            // intersectSub -> prevent premature retesselate/canonicalize
            csgplane = csgplane.intersectSub(csgshell);
            // only keep the polygons in the z plane:
            var polys = csgplane.polygons.filter(function(polygon) {
                return Math.abs(polygon.plane.normal.z) > 0.99;
            });
            // finally, position the plane per passed transformations
            return polys.map(function(poly) {
                return poly.transform(m);
            });
        },


        /*
         * given 2 connectors, this returns all polygons of a "wall" between 2
         * copies of this cag, positioned in 3d space as "bottom" and
         * "top" plane per connectors toConnector1, and toConnector2, respectively 
         */
        _toWallPolygons: function(options) {
            // normals are going to be correct as long as toConn2.point - toConn1.point
            // points into cag normal direction (check in caller)
            // arguments: options.toConnector1, options.toConnector2, options.cag
            //     walls go from toConnector1 to toConnector2
            //     optionally, target cag to point to - cag needs to have same number of sides as this!
            var origin = [0, 0, 0], defaultAxis = [0, 0, 1], defaultNormal = [0, 1, 0];
            var thisConnector = new CSG.Connector(origin, defaultAxis, defaultNormal);
            // arguments:
            var toConnector1 = options.toConnector1;
            // var toConnector2 = new CSG.Connector([0, 0, -30], defaultAxis, defaultNormal);
            var toConnector2 = options.toConnector2;
            if (!(toConnector1 instanceof CSG.Connector && toConnector2 instanceof CSG.Connector)) {
                throw('could not parse CSG.Connector arguments toConnector1 or toConnector2');
            }
            if (options.cag) {
                if (options.cag.sides.length != this.sides.length) {
                    throw('target cag needs same sides count as start cag');
                }
            }
            // target cag is same as this unless specified
            var toCag = options.cag || this;
            var m1 = thisConnector.getTransformationTo(toConnector1, false, 0);
            var m2 = thisConnector.getTransformationTo(toConnector2, false, 0);
            var vps1 = this._toVector3DPairs(m1);
            var vps2 = toCag._toVector3DPairs(m2);

            var polygons = [];
            vps1.forEach(function(vp1, i) {
                polygons.push(new CSG.Polygon([
                    new CSG.Vertex(vps2[i][1]), new CSG.Vertex(vps2[i][0]), new CSG.Vertex(vp1[0])]));
                polygons.push(new CSG.Polygon([
                    new CSG.Vertex(vps2[i][1]), new CSG.Vertex(vp1[0]), new CSG.Vertex(vp1[1])]));
            });
            return polygons;
        },

        union: function(cag) {
            var cags;
            if (cag instanceof Array) {
                cags = cag;
            } else {
                cags = [cag];
            }
            var r = this._toCSGWall(-1, 1);
            var r = r.union(
                cags.map(function(cag) {
                    return cag._toCSGWall(-1, 1).reTesselated();
                }), false, false)
            return CAG.fromFakeCSG(r).canonicalized();
        },

        subtract: function(cag) {
            var cags;
            if (cag instanceof Array) {
                cags = cag;
            } else {
                cags = [cag];
            }
            var r = this._toCSGWall(-1, 1);
            cags.map(function(cag) {
                r = r.subtractSub(cag._toCSGWall(-1, 1), false, false);
            });
            r = r.reTesselated();
            r = r.canonicalized();
            r = CAG.fromFakeCSG(r);
            r = r.canonicalized();
            return r;
        },

        intersect: function(cag) {
            var cags;
            if (cag instanceof Array) {
                cags = cag;
            } else {
                cags = [cag];
            }
            var r = this._toCSGWall(-1, 1);
            cags.map(function(cag) {
                r = r.intersectSub(cag._toCSGWall(-1, 1), false, false);
            });
            r = r.reTesselated();
            r = r.canonicalized();
            r = CAG.fromFakeCSG(r);
            r = r.canonicalized();
            return r;
        },

        transform: function(matrix4x4) {
            var ismirror = matrix4x4.isMirroring();
            var newsides = this.sides.map(function(side) {
                return side.transform(matrix4x4);
            });
            var result = CAG.fromSides(newsides);
            if (ismirror) {
                result = result.flipped();
            }
            return result;
        },

        // see http://local.wasp.uwa.edu.au/~pbourke/geometry/polyarea/ :
        // Area of the polygon. For a counter clockwise rotating polygon the area is positive, otherwise negative
        // Note(bebbi): this looks wrong. See polygon getArea()
        area: function() {
            var polygonArea = 0;
            this.sides.map(function(side) {
                polygonArea += side.vertex0.pos.cross(side.vertex1.pos);
            });
            polygonArea *= 0.5;
            return polygonArea;
        },

        flipped: function() {
            var newsides = this.sides.map(function(side) {
                return side.flipped();
            });
            newsides.reverse();
            return CAG.fromSides(newsides);
        },

        getBounds: function() {
            var minpoint;
            if (this.sides.length === 0) {
                minpoint = new CSG.Vector2D(0, 0);
            } else {
                minpoint = this.sides[0].vertex0.pos;
            }
            var maxpoint = minpoint;
            this.sides.map(function(side) {
                minpoint = minpoint.min(side.vertex0.pos);
                minpoint = minpoint.min(side.vertex1.pos);
                maxpoint = maxpoint.max(side.vertex0.pos);
                maxpoint = maxpoint.max(side.vertex1.pos);
            });
            return [minpoint, maxpoint];
        },

        isSelfIntersecting: function(debug) {
            var numsides = this.sides.length;
            for (var i = 0; i < numsides; i++) {
                var side0 = this.sides[i];
                for (var ii = i + 1; ii < numsides; ii++) {
                    var side1 = this.sides[ii];
                    if (CAG.linesIntersect(side0.vertex0.pos, side0.vertex1.pos, side1.vertex0.pos, side1.vertex1.pos)) {
                        if (debug) { OpenJsCad.log(side0); OpenJsCad.log(side1);}
                        return true;
                    }
                }
            }
            return false;
        },

        expandedShell: function(radius, resolution) {
            resolution = resolution || 8;
            if (resolution < 4) resolution = 4;
            var cags = [];
            var pointmap = {};
            var cag = this.canonicalized();
            cag.sides.map(function(side) {
                var d = side.vertex1.pos.minus(side.vertex0.pos);
                var dl = d.length();
                if (dl > 1e-5) {
                    d = d.times(1.0 / dl);
                    var normal = d.normal().times(radius);
                    var shellpoints = [
                        side.vertex1.pos.plus(normal),
                        side.vertex1.pos.minus(normal),
                        side.vertex0.pos.minus(normal),
                        side.vertex0.pos.plus(normal)
                    ];
                    //      var newcag = CAG.fromPointsNoCheck(shellpoints);
                    var newcag = CAG.fromPoints(shellpoints);
                    cags.push(newcag);
                    for (var step = 0; step < 2; step++) {
                        var p1 = (step === 0) ? side.vertex0.pos : side.vertex1.pos;
                        var p2 = (step === 0) ? side.vertex1.pos : side.vertex0.pos;
                        var tag = p1.x + " " + p1.y;
                        if (!(tag in pointmap)) {
                            pointmap[tag] = [];
                        }
                        pointmap[tag].push({
                            "p1": p1,
                            "p2": p2
                        });
                    }
                }
            });
            for (var tag in pointmap) {
                var m = pointmap[tag];
                var angle1, angle2;
                var pcenter = m[0].p1;
                if (m.length == 2) {
                    var end1 = m[0].p2;
                    var end2 = m[1].p2;
                    angle1 = end1.minus(pcenter).angleDegrees();
                    angle2 = end2.minus(pcenter).angleDegrees();
                    if (angle2 < angle1) angle2 += 360;
                    if (angle2 >= (angle1 + 360)) angle2 -= 360;
                    if (angle2 < angle1 + 180) {
                        var t = angle2;
                        angle2 = angle1 + 360;
                        angle1 = t;
                    }
                    angle1 += 90;
                    angle2 -= 90;
                } else {
                    angle1 = 0;
                    angle2 = 360;
                }
                var fullcircle = (angle2 > angle1 + 359.999);
                if (fullcircle) {
                    angle1 = 0;
                    angle2 = 360;
                }
                if (angle2 > (angle1 + 1e-5)) {
                    var points = [];
                    if (!fullcircle) {
                        points.push(pcenter);
                    }
                    var numsteps = Math.round(resolution * (angle2 - angle1) / 360);
                    if (numsteps < 1) numsteps = 1;
                    for (var step = 0; step <= numsteps; step++) {
                        var angle = angle1 + step / numsteps * (angle2 - angle1);
                        if (step == numsteps) angle = angle2; // prevent rounding errors
                        var point = pcenter.plus(CSG.Vector2D.fromAngleDegrees(angle).times(radius));
                        if ((!fullcircle) || (step > 0)) {
                            points.push(point);
                        }
                    }
                    var newcag = CAG.fromPointsNoCheck(points);
                    cags.push(newcag);
                }
            }
            var result = new CAG();
            result = result.union(cags);
            return result;
        },

        expand: function(radius, resolution) {
            var result = this.union(this.expandedShell(radius, resolution));
            return result;
        },

        contract: function(radius, resolution) {
            var result = this.subtract(this.expandedShell(radius, resolution));
            return result;
        },

        // extrude the CAG in a certain plane. 
        // Giving just a plane is not enough, multiple different extrusions in the same plane would be possible
        // by rotating around the plane's origin. An additional right-hand vector should be specified as well,
        // and this is exactly a CSG.OrthoNormalBasis.
        // orthonormalbasis: characterizes the plane in which to extrude
        // depth: thickness of the extruded shape. Extrusion is done symmetrically above and below the plane.
        extrudeInOrthonormalBasis: function(orthonormalbasis, depth) {
            // first extrude in the regular Z plane:
            if (!(orthonormalbasis instanceof CSG.OrthoNormalBasis)) {
                throw new Error("extrudeInPlane: the first parameter should be a CSG.OrthoNormalBasis");
            }
            var extruded = this.extrude({
                offset: [0, 0, depth]
            });
            var matrix = orthonormalbasis.getInverseProjectionMatrix();
            extruded = extruded.transform(matrix);
            return extruded;
        },

        // Extrude in a standard cartesian plane, specified by two axis identifiers. Each identifier can be
        // one of ["X","Y","Z","-X","-Y","-Z"]
        // The 2d x axis will map to the first given 3D axis, the 2d y axis will map to the second.
        // See CSG.OrthoNormalBasis.GetCartesian for details.
        extrudeInPlane: function(axis1, axis2, depth) {
            return this.extrudeInOrthonormalBasis(CSG.OrthoNormalBasis.GetCartesian(axis1, axis2), depth);
        },

        // extruded=cag.extrude({offset: [0,0,10], twistangle: 360, twiststeps: 100});
        // linear extrusion of 2D shape, with optional twist
        // The 2d shape is placed in in z=0 plane and extruded into direction <offset> (a CSG.Vector3D)
        // The final face is rotated <twistangle> degrees. Rotation is done around the origin of the 2d shape (i.e. x=0, y=0)
        // twiststeps determines the resolution of the twist (should be >= 1)
        // returns a CSG object
        extrude: function(options) {
            if (this.sides.length == 0) {
                // empty!
                return new CSG();
            }
            var offsetVector = CSG.parseOptionAs3DVector(options, "offset", [0, 0, 1]);
            var twistangle = CSG.parseOptionAsFloat(options, "twistangle", 0);
            var twiststeps = CSG.parseOptionAsInt(options, "twiststeps", CSG.defaultResolution3D);
            if (offsetVector.z == 0) {
                throw('offset cannot be orthogonal to Z axis');
            }
            if (twistangle == 0 || twiststeps < 1) {
                twiststeps = 1;
            }
            var normalVector = CSG.Vector3D.Create(0, 1, 0);

            var polygons = [];
            // bottom and top
            polygons = polygons.concat(this._toPlanePolygons({translation: [0, 0, 0],
                normalVector: normalVector, flipped: !(offsetVector.z < 0)}));
            polygons = polygons.concat(this._toPlanePolygons({translation: offsetVector,
                normalVector: normalVector.rotateZ(twistangle), flipped: offsetVector.z < 0}));
            // walls
            for (var i = 0; i < twiststeps; i++) {
                var c1 = new CSG.Connector(offsetVector.times(i / twiststeps), [0, 0, offsetVector.z],
                    normalVector.rotateZ(i * twistangle/twiststeps));
                var c2 = new CSG.Connector(offsetVector.times((i + 1) / twiststeps), [0, 0, offsetVector.z],
                    normalVector.rotateZ((i + 1) * twistangle/twiststeps));
                polygons = polygons.concat(this._toWallPolygons({toConnector1: c1, toConnector2: c2}));
            }

            return CSG.fromPolygons(polygons);
        },

        /*
         * extrude CAG to 3d object by rotating the origin around the y axis
         * (and turning everything into XY plane)
         * arguments: options dict with angle and resolution, both optional
         */
        rotateExtrude: function(options) {
            var alpha = CSG.parseOptionAsFloat(options, "angle", 360);
            var resolution = CSG.parseOptionAsInt(options, "resolution", CSG.defaultResolution3D);

            var EPS = 1e-5;

            alpha = alpha > 360 ? alpha % 360 : alpha;
            var origin = [0, 0, 0];
            var axisV = CSG.Vector3D.Create(0, 1, 0);
            var normalV = [0, 0, 1];
            var polygons = [];
            // planes only needed if alpha > 0
            var connS = new CSG.Connector(origin, axisV, normalV);
            if (alpha > 0 && alpha < 360) {
                // we need to rotate negative to satisfy wall function condition of
                // building in the direction of axis vector
                var connE = new CSG.Connector(origin, axisV.rotateZ(-alpha), normalV);
                polygons = polygons.concat(
                    this._toPlanePolygons({toConnector: connS, flipped: true}));
                polygons = polygons.concat(
                    this._toPlanePolygons({toConnector: connE}));
            }
            var connT1 = connS, connT2;
            var step = alpha/resolution;
            for (var a = step; a <= alpha + EPS; a += step) {
                connT2 = new CSG.Connector(origin, axisV.rotateZ(-a), normalV);
                polygons = polygons.concat(this._toWallPolygons(
                    {toConnector1: connT1, toConnector2: connT2}));
                connT1 = connT2;
            }
            return CSG.fromPolygons(polygons).reTesselated();
        },

        // check if we are a valid CAG (for debugging)
        // NOTE(bebbi) uneven side count doesn't work because rounding with EPS isn't taken into account
        check: function() {
            var EPS = 1e-5;
            var errors = [];
            if (this.isSelfIntersecting(true)) {
                errors.push("Self intersects");
            }
            var pointcount = {};
            this.sides.map(function(side) {
                function mappoint(p) {
                    var tag = p.x + " " + p.y;
                    if (!(tag in pointcount)) pointcount[tag] = 0;
                    pointcount[tag] ++;
                }
                mappoint(side.vertex0.pos);
                mappoint(side.vertex1.pos);
            });
            for (var tag in pointcount) {
                var count = pointcount[tag];
                if (count & 1) {
                    errors.push("Uneven number of sides (" + count + ") for point " + tag);
                }
            }
            var area = this.area();
            if (area < EPS*EPS) {
                errors.push("Area is " + area);
            }
            if (errors.length > 0) {
                var ertxt = "";
                errors.map(function(err) {
                    ertxt += err + "\n";
                });
                throw new Error(ertxt);
            }
        },

        canonicalized: function() {
            if (this.isCanonicalized) {
                return this;
            } else {
                var factory = new CAG.fuzzyCAGFactory();
                var result = factory.getCAG(this);
                result.isCanonicalized = true;
                return result;
            }
        },

        toCompactBinary: function() {
            var cag = this.canonicalized();
            var numsides = cag.sides.length;
            var vertexmap = {};
            var vertices = [];
            var numvertices = 0;
            var sideVertexIndices = new Uint32Array(2 * numsides);
            var sidevertexindicesindex = 0;
            cag.sides.map(function(side) {
                [side.vertex0, side.vertex1].map(function(v) {
                    var vertextag = v.getTag();
                    var vertexindex;
                    if (!(vertextag in vertexmap)) {
                        vertexindex = numvertices++;
                        vertexmap[vertextag] = vertexindex;
                        vertices.push(v);
                    } else {
                        vertexindex = vertexmap[vertextag];
                    }
                    sideVertexIndices[sidevertexindicesindex++] = vertexindex;
                });
            });
            var vertexData = new Float64Array(numvertices * 2);
            var verticesArrayIndex = 0;
            vertices.map(function(v) {
                var pos = v.pos;
                vertexData[verticesArrayIndex++] = pos._x;
                vertexData[verticesArrayIndex++] = pos._y;
            });
            var result = {
                'class': "CAG",
                sideVertexIndices: sideVertexIndices,
                vertexData: vertexData
            };
            return result;
        },

        getOutlinePaths: function() {
            var cag = this.canonicalized();
            var sideTagToSideMap = {};
            var startVertexTagToSideTagMap = {};
            cag.sides.map(function(side) {
                var sidetag = side.getTag();
                sideTagToSideMap[sidetag] = side;
                var startvertextag = side.vertex0.getTag();
                if (!(startvertextag in startVertexTagToSideTagMap)) {
                    startVertexTagToSideTagMap[startvertextag] = [];
                }
                startVertexTagToSideTagMap[startvertextag].push(sidetag);
            });
            var paths = [];
            while (true) {
                var startsidetag = null;
                for (var aVertexTag in startVertexTagToSideTagMap) {
                    var sidesForThisVertex = startVertexTagToSideTagMap[aVertexTag];
                    startsidetag = sidesForThisVertex[0];
                    sidesForThisVertex.splice(0, 1);
                    if (sidesForThisVertex.length === 0) {
                        delete startVertexTagToSideTagMap[aVertexTag];
                    }
                    break;
                }
                if (startsidetag === null) break; // we've had all sides
                var connectedVertexPoints = [];
                var sidetag = startsidetag;
                var thisside = sideTagToSideMap[sidetag];
                var startvertextag = thisside.vertex0.getTag();
                while (true) {
                    connectedVertexPoints.push(thisside.vertex0.pos);
                    var nextvertextag = thisside.vertex1.getTag();
                    if (nextvertextag == startvertextag) break; // we've closed the polygon
                    if (!(nextvertextag in startVertexTagToSideTagMap)) {
                        throw new Error("Area is not closed!");
                    }
                    var nextpossiblesidetags = startVertexTagToSideTagMap[nextvertextag];
                    var nextsideindex = -1;
                    if (nextpossiblesidetags.length == 1) {
                        nextsideindex = 0;
                    } else {
                        // more than one side starting at the same vertex. This means we have
                        // two shapes touching at the same corner
                        var bestangle = null;
                        var thisangle = thisside.direction().angleDegrees();
                        for (var sideindex = 0; sideindex < nextpossiblesidetags.length; sideindex++) {
                            var nextpossiblesidetag = nextpossiblesidetags[sideindex];
                            var possibleside = sideTagToSideMap[nextpossiblesidetag];
                            var angle = possibleside.direction().angleDegrees();
                            var angledif = angle - thisangle;
                            if (angledif < -180) angledif += 360;
                            if (angledif >= 180) angledif -= 360;
                            if ((nextsideindex < 0) || (angledif > bestangle)) {
                                nextsideindex = sideindex;
                                bestangle = angledif;
                            }
                        }
                    }
                    var nextsidetag = nextpossiblesidetags[nextsideindex];
                    nextpossiblesidetags.splice(nextsideindex, 1);
                    if (nextpossiblesidetags.length === 0) {
                        delete startVertexTagToSideTagMap[nextvertextag];
                    }
                    thisside = sideTagToSideMap[nextsidetag];
                } // inner loop
                var path = new CSG.Path2D(connectedVertexPoints, true);
                paths.push(path);
            } // outer loop
            return paths;
        },

        /*
        cag = cag.overCutInsideCorners(cutterradius);

        Using a CNC router it's impossible to cut out a true sharp inside corner. The inside corner
        will be rounded due to the radius of the cutter. This function compensates for this by creating
        an extra cutout at each inner corner so that the actual cut out shape will be at least as large
        as needed.
        */
        overCutInsideCorners: function(cutterradius) {
            var cag = this.canonicalized();
            // for each vertex determine the 'incoming' side and 'outgoing' side:
            var pointmap = {}; // tag => {pos: coord, from: [], to: []}
            cag.sides.map(function(side) {
                if (!(side.vertex0.getTag() in pointmap)) {
                    pointmap[side.vertex0.getTag()] = {
                        pos: side.vertex0.pos,
                        from: [],
                        to: []
                    };
                }
                pointmap[side.vertex0.getTag()].to.push(side.vertex1.pos);
                if (!(side.vertex1.getTag() in pointmap)) {
                    pointmap[side.vertex1.getTag()] = {
                        pos: side.vertex1.pos,
                        from: [],
                        to: []
                    };
                }
                pointmap[side.vertex1.getTag()].from.push(side.vertex0.pos);
            });
            // overcut all sharp corners:
            var cutouts = [];
            for (var pointtag in pointmap) {
                var pointobj = pointmap[pointtag];
                if ((pointobj.from.length == 1) && (pointobj.to.length == 1)) {
                    // ok, 1 incoming side and 1 outgoing side:
                    var fromcoord = pointobj.from[0];
                    var pointcoord = pointobj.pos;
                    var tocoord = pointobj.to[0];
                    var v1 = pointcoord.minus(fromcoord).unit();
                    var v2 = tocoord.minus(pointcoord).unit();
                    var crossproduct = v1.cross(v2);
                    var isInnerCorner = (crossproduct < 0.001);
                    if (isInnerCorner) {
                        // yes it's a sharp corner:
                        var alpha = v2.angleRadians() - v1.angleRadians() + Math.PI;
                        if (alpha < 0) {
                            alpha += 2 * Math.PI;
                        } else if (alpha >= 2 * Math.PI) {
                            alpha -= 2 * Math.PI;
                        }
                        var midvector = v2.minus(v1).unit();
                        var circlesegmentangle = 30 / 180 * Math.PI; // resolution of the circle: segments of 30 degrees
                        // we need to increase the radius slightly so that our imperfect circle will contain a perfect circle of cutterradius
                        var radiuscorrected = cutterradius / Math.cos(circlesegmentangle / 2);
                        var circlecenter = pointcoord.plus(midvector.times(radiuscorrected));
                        // we don't need to create a full circle; a pie is enough. Find the angles for the pie:
                        var startangle = alpha + midvector.angleRadians();
                        var deltaangle = 2 * (Math.PI - alpha);
                        var numsteps = 2 * Math.ceil(deltaangle / circlesegmentangle / 2); // should be even
                        // build the pie:
                        var points = [circlecenter];
                        for (var i = 0; i <= numsteps; i++) {
                            var angle = startangle + i / numsteps * deltaangle;
                            var p = CSG.Vector2D.fromAngleRadians(angle).times(radiuscorrected).plus(circlecenter);
                            points.push(p);
                        }
                        cutouts.push(CAG.fromPoints(points));
                    }
                }
            }
            var result = cag.subtract(cutouts);
            return result;
        }
    };

    CAG.Vertex = function(pos) {
        this.pos = pos;
    };

    CAG.Vertex.fromObject = function(obj) {
        return new CAG.Vertex(new CSG.Vector2D(obj.pos._x,obj.pos._y));
    };

    CAG.Vertex.prototype = {
        toString: function() {
            return "(" + this.pos.x.toFixed(2) + "," + this.pos.y.toFixed(2) + ")";
        },
        getTag: function() {
            var result = this.tag;
            if (!result) {
                result = CSG.getTag();
                this.tag = result;
            }
            return result;
        }
    };

    CAG.Side = function(vertex0, vertex1) {
        if (!(vertex0 instanceof CAG.Vertex)) throw new Error("Assertion failed");
        if (!(vertex1 instanceof CAG.Vertex)) throw new Error("Assertion failed");
        this.vertex0 = vertex0;
        this.vertex1 = vertex1;
    };

    CAG.Side.fromObject = function(obj) {
        var vertex0 = CAG.Vertex.fromObject(obj.vertex0);
        var vertex1 = CAG.Vertex.fromObject(obj.vertex1);
        return new CAG.Side(vertex0,vertex1);
    };

    CAG.Side._fromFakePolygon = function(polygon) {
        polygon.vertices.forEach(function(v) {
            if (!((v.pos.z >= -1.001) && (v.pos.z < -0.999)) && !((v.pos.z >= 0.999) && (v.pos.z < 1.001))) {
                throw("Assertion failed: _fromFakePolygon expects abs z values of 1");
            }
        })
        // this can happen based on union, seems to be residuals -
        // return null and handle in caller
        if (polygon.vertices.length < 4) {
            return null;
        }
        var reverse = false;
        var vert1Indices = [];
        var pts2d = polygon.vertices.filter(function(v, i) {
            if (v.pos.z > 0) {
                vert1Indices.push(i);
                return true;
            }
        })
        .map(function(v) {
            return new CSG.Vector2D(v.pos.x, v.pos.y);
        });
        if (pts2d.length != 2) {
            throw('Assertion failed: _fromFakePolygon: not enough points found')
        }
        var d = vert1Indices[1] - vert1Indices[0];
        if (d == 1 || d == 3) {
            if (d == 1) {
                pts2d.reverse();
            }
        } else {
            throw('Assertion failed: _fromFakePolygon: unknown index ordering');
        }
        var result = new CAG.Side(new CAG.Vertex(pts2d[0]), new CAG.Vertex(pts2d[1]));
        return result;
    };

    CAG.Side.prototype = {
        toString: function() {
            return this.vertex0 + " -> " + this.vertex1;
        },

        toPolygon3D: function(z0, z1) {
            var vertices = [
                new CSG.Vertex(this.vertex0.pos.toVector3D(z0)),
                new CSG.Vertex(this.vertex1.pos.toVector3D(z0)),
                new CSG.Vertex(this.vertex1.pos.toVector3D(z1)),
                new CSG.Vertex(this.vertex0.pos.toVector3D(z1))
            ];
            return new CSG.Polygon(vertices);
        },

        transform: function(matrix4x4) {
            var newp1 = this.vertex0.pos.transform(matrix4x4);
            var newp2 = this.vertex1.pos.transform(matrix4x4);
            return new CAG.Side(new CAG.Vertex(newp1), new CAG.Vertex(newp2));
        },

        flipped: function() {
            return new CAG.Side(this.vertex1, this.vertex0);
        },

        direction: function() {
            return this.vertex1.pos.minus(this.vertex0.pos);
        },

        getTag: function() {
            var result = this.tag;
            if (!result) {
                result = CSG.getTag();
                this.tag = result;
            }
            return result;
        },

        lengthSquared: function() {
            var x = this.vertex1.pos.x - this.vertex0.pos.x,
                y = this.vertex1.pos.y - this.vertex0.pos.y;
            return x * x + y * y;
        },

        length: function() {
            return Math.sqrt(this.lengthSquared());
        }
    };

    //////////////////////////////////////
    CAG.fuzzyCAGFactory = function() {
        this.vertexfactory = new CSG.fuzzyFactory(2, 1e-5);
    };

    CAG.fuzzyCAGFactory.prototype = {
        getVertex: function(sourcevertex) {
            var elements = [sourcevertex.pos._x, sourcevertex.pos._y];
            var result = this.vertexfactory.lookupOrCreate(elements, function(els) {
                return sourcevertex;
            });
            return result;
        },

        getSide: function(sourceside) {
            var vertex0 = this.getVertex(sourceside.vertex0);
            var vertex1 = this.getVertex(sourceside.vertex1);
            return new CAG.Side(vertex0, vertex1);
        },

        getCAG: function(sourcecag) {
            var _this = this;
            var newsides = sourcecag.sides.map(function(side) {
                return _this.getSide(side);
            })
            // remove bad sides (mostly a user input issue)
            .filter(function(side) {
                return side.length() > 1e-5;
            });
            return CAG.fromSides(newsides);
        }
    };

    //////////////////////////////////////
    CSG.addTransformationMethodsToPrototype(CSG.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Vector2D.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Vector3D.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Vertex.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Plane.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Polygon.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Line3D.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Connector.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Path2D.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.Line2D.prototype);
    CSG.addTransformationMethodsToPrototype(CAG.prototype);
    CSG.addTransformationMethodsToPrototype(CAG.Side.prototype);
    CSG.addTransformationMethodsToPrototype(CSG.OrthoNormalBasis.prototype);

    CSG.addCenteringToPrototype(CSG.prototype, ['x', 'y', 'z']);
    CSG.addCenteringToPrototype(CAG.prototype, ['x', 'y']);

    /*
    2D polygons are now supported through the CAG class.
    With many improvements (see documentation):
      - shapes do no longer have to be convex
      - union/intersect/subtract is supported
      - expand / contract are supported

    But we'll keep CSG.Polygon2D as a stub for backwards compatibility
    */
    
    CSG.Polygon2D = function(points) {
        var cag = CAG.fromPoints(points);
        this.sides = cag.sides;
    };
    CSG.Polygon2D.prototype = CAG.prototype;


    //console.log('module', module)
    //module.CSG = CSG;
    //module.CAG = CAG;
//})(this); //module to export to

module.exports = {CSG,CAG}//({})(module)

},{}],2:[function(require,module,exports){
(function (Buffer){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

Object.defineProperty(exports, '__esModule', { value: true });

var _jscad_csg = require('@jscad/csg');

/*
 * Blob.js
 * See https://developer.mozilla.org/en-US/docs/Web/API/Blob
 *
 * Node and Browserify Compatible
 *
 * Copyright (c) 2015 by Z3 Dev (@zdev/www.z3dev.jp)
 * License: MIT License
 *
 * This implementation uses the Buffer class for all storage.
 * See https://nodejs.org/api/buffer.html
 *
 * URL.createObjectURL(blob)
 *
 * History:
 * 2015/07/02: 0.0.1: contributed to OpenJSCAD.org CLI openjscad
 */

function makeBlob(contents, options) {
  var blob = typeof window !== 'undefined' ? window.Blob : Blob;
  return blob;
}

function Blob(contents, options) {
  var this$1 = this;

  // make the optional options non-optional
  options = options || {};
  // number of bytes
  this.size = 0; // contents, not allocation
  // media type
  this.type = '';
  // readability state (CLOSED: true, OPENED: false)
  this.isClosed = false;
  // encoding of given strings
  this.encoding = 'utf8';
  // storage
  this.buffer = null;
  this.length = 32e+6; // allocation, not contents

  if (!contents) {
    return;
  }
  if (!Array.isArray(contents)) {
    return;
  }

  // process options if any
  if (options.type) {
    // TBD if type contains any chars outside range U+0020 to U+007E, then set type to the empty string
    // Convert every character in type to lowercase
    this.type = options.type.toLowerCase();
  }
  if (options.endings) {
    // convert the EOL on strings
  }
  if (options.encoding) {
    this.encoding = options.encoding.toLowerCase();
  }
  if (options.length) {
    this.length = options.length;
  }

  var wbytes;
  var object;
  // convert the contents (String, ArrayBufferView, ArrayBuffer, Blob)
  this.buffer = new Buffer(this.length);
  var index = 0;
  for (index = 0; index < contents.length; index++) {
    switch (_typeof(contents[index])) {
      case 'string':
        wbytes = this$1.buffer.write(contents[index], this$1.size, this$1.encoding);
        this$1.size = this$1.size + wbytes;
        break;
      case 'object':
        object = contents[index]; // this should be a reference to an object
        if (Buffer.isBuffer(object)) {}
        if (object instanceof ArrayBuffer) {
          var view = new DataView(object);
          var bindex = 0;
          for (bindex = 0; bindex < object.byteLength; bindex++) {
            var xbyte = view.getUint8(bindex);
            wbytes = this$1.buffer.writeUInt8(xbyte, this$1.size, false);
            this$1.size++;
          }
        }
        break;
      default:
        break;
    }
  }
  return this;
}

Blob.prototype = {
  asBuffer: function asBuffer() {
    return this.buffer.slice(0, this.size);
  },

  slice: function slice(start, end, type) {
    start = start || 0;
    end = end || this.size;
    type = type || '';
    return new Blob();
  },

  close: function close() {
    // if state of context objext is already CLOSED then return
    if (this.isClosed) {
      return;
    }
    // set the readbility state of the context object to CLOSED and remove storage
    this.isClosed = true;
  },

  toString: function toString() {
    return 'blob blob blob';
  }
};

function revokeBlobUrl(url) {
  if (window.URL) {
    window.URL.revokeObjectURL(url);
  } else if (window.webkitURL) {
    window.webkitURL.revokeObjectURL(url);
  } else {
    throw new Error("Your browser doesn't support window.URL");
  }
}

var Blob$1 = makeBlob();

function CAGToDxf(cagObject) {
  var paths = cagObject.getOutlinePaths();
  return PathsToDxf(paths);
}

function PathsToDxf(paths) {
  var str = '999\nDXF generated by OpenJsCad\n';
  str += '  0\nSECTION\n  2\nHEADER\n';
  str += '  0\nENDSEC\n';
  str += '  0\nSECTION\n  2\nTABLES\n';
  str += '  0\nTABLE\n  2\nLTYPE\n  70\n1\n';
  str += '  0\nLTYPE\n  2\nCONTINUOUS\n  3\nSolid Line\n  72\n65\n  73\n0\n  40\n0.0\n';
  str += '  0\nENDTAB\n';
  str += '  0\nTABLE\n  2\nLAYER\n  70\n1\n';
  str += '  0\nLAYER\n  2\nOpenJsCad\n  62\n7\n  6\ncontinuous\n';
  str += '  0\nENDTAB\n';
  str += '  0\nTABLE\n  2\nSTYLE\n  70\n0\n  0\nENDTAB\n';
  str += '  0\nTABLE\n  2\nVIEW\n  70\n0\n  0\nENDTAB\n';
  str += '  0\nENDSEC\n';
  str += '  0\nSECTION\n  2\nBLOCKS\n';
  str += '  0\nENDSEC\n';
  str += '  0\nSECTION\n  2\nENTITIES\n';
  paths.map(function (path) {
    var numpoints_closed = path.points.length + (path.closed ? 1 : 0);
    str += '  0\nLWPOLYLINE\n  8\nOpenJsCad\n  90\n' + numpoints_closed + '\n  70\n' + (path.closed ? 1 : 0) + '\n';
    for (var pointindex = 0; pointindex < numpoints_closed; pointindex++) {
      var pointindexwrapped = pointindex;
      if (pointindexwrapped >= path.points.length) {
        pointindexwrapped -= path.points.length;
      }
      var point = path.points[pointindexwrapped];
      str += ' 10\n' + point.x + '\n 20\n' + point.y + '\n 30\n0.0\n';
    }
  });
  str += '  0\nENDSEC\n  0\nEOF\n';
  return new Blob$1([str], {
    type: 'application/dxf'
  });
}

var Blob$2 = makeBlob();

function CAGToJson(CAG) {
  var str = '{ "type": "cag","sides": [';
  var comma = '';
  CAG.sides.map(function (side) {
    str += comma;
    str += JSON.stringify(side);
    comma = ',';
  });
  str += '] }';
  return new Blob$2([str], {
    type: 'application/json'
  });
}

var Blob$3 = makeBlob();

function CAGToSvg(cagObject) {
  var decimals = 1000;

  // mirror the CAG about the X axis in order to generate paths into the POSITIVE direction
  var plane = new _jscad_csg.CSG.Plane(_jscad_csg.CSG.Vector3D.Create(0, 1, 0), 0);
  var cag = cagObject.transform(_jscad_csg.CSG.Matrix4x4.mirroring(plane));

  var bounds = cag.getBounds();
  var paths = cag.getOutlinePaths();
  var width = Math.round((bounds[1].x - bounds[0].x) * decimals) / decimals;
  var height = Math.round((bounds[1].y - bounds[0].y) * decimals) / decimals;
  var svg = '<?xml version="1.0" encoding="UTF-8"?>\n';
  svg += '<!-- Generated by OpenJSCAD.org -->\n';
  svg += '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1 Tiny//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-tiny.dtd">\n';
  svg += '<svg width="' + width + 'mm" height="' + height + 'mm" viewBox="0 0 ' + width + ' ' + height + '" version="1.1" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n';
  svg += PathsToSvg(paths, bounds);
  svg += '</svg>';
  return new Blob$3([svg], {
    type: 'image/svg+xml'
  });
}

function PathsToSvg(paths, bounds) {
  // calculate offsets in order to create paths orientated from the 0,0 axis
  var xoffset = 0 - bounds[0].x;
  var yoffset = 0 - bounds[0].y;
  var str = '<g>\n';
  paths.map(function (path) {
    str += '<path d="';
    // FIXME add fill color when CAG has support for colors
    var numpoints_closed = path.points.length + (path.closed ? 1 : 0);
    for (var pointindex = 0; pointindex < numpoints_closed; pointindex++) {
      var pointindexwrapped = pointindex;
      if (pointindexwrapped >= path.points.length) {
        pointindexwrapped -= path.points.length;
      }
      var point = path.points[pointindexwrapped];
      if (pointindex > 0) {
        str += 'L' + (point.x + xoffset) + ' ' + (point.y + yoffset);
      } else {
        str += 'M' + (point.x + xoffset) + ' ' + (point.y + yoffset);
      }
    }
    str += '"/>\n';
  });
  str += '</g>\n';
  return str;
}

var Blob$4 = makeBlob();

function CSGToAMF(CSG, m) {
  var result = '<?xml version="1.0" encoding="UTF-8"?>\n<amf' + (m && m.unit ? ' unit="+m.unit"' : '') + '>\n';
  for (var k in m) {
    result += '<metadata type="' + k + '">' + m[k] + '</metadata>\n';
  }
  result += '<object id="0">\n<mesh>\n<vertices>\n';

  CSG.polygons.map(function (p) {
    // first we dump all vertices of all polygons
    for (var i = 0; i < p.vertices.length; i++) {
      result += CSGVertextoAMFString(p.vertices[i]);
    }
  });
  result += '</vertices>\n';

  var n = 0;
  CSG.polygons.map(function (p) {
    // then we dump all polygons
    result += '<volume>\n';
    if (p.vertices.length < 3) {
      return;
    }
    var color = null;
    if (p.shared && p.shared.color) {
      color = p.shared.color;
    } else if (p.color) {
      color = p.color;
    }
    if (color != null) {
      if (color.length < 4) {
        color.push(1.);
      }
      result += '<color><r>' + color[0] + '</r><g>' + color[1] + '</g><b>' + color[2] + '</b><a>' + color[3] + '</a></color>';
    }

    for (var i = 0; i < p.vertices.length - 2; i++) {
      // making sure they are all triangles (triangular polygons)
      result += '<triangle>';
      result += '<v1>' + n + '</v1>';
      result += '<v2>' + (n + i + 1) + '</v2>';
      result += '<v3>' + (n + i + 2) + '</v3>';
      result += '</triangle>\n';
    }
    n += p.vertices.length;
    result += '</volume>\n';
  });
  result += '</mesh>\n</object>\n';
  result += '</amf>\n';

  return new Blob$4([result], {
    type: 'application/amf+xml'
  });
}

function CSGVectortoAMFString(v) {
  return '<x>' + v._x + '</x><y>' + v._y + '</y><z>' + v._z + '</z>';
}

function CSGVertextoAMFString(vertex) {
  return '<vertex><coordinates>' + CSGVectortoAMFString(vertex.pos) + '</coordinates></vertex>\n';
}
/*
CSG.Vector3D.prototype.toAMFString = function () {
  return '<x>' + this._x + '</x><y>' + this._y + '</y><z>' + this._z + '</z>'
}

CSG.Vertex.prototype.toAMFString = function () {
  return '<vertex><coordinates>' + this.pos.toAMFString() + '</coordinates></vertex>\n'
}*/

var Blob$5 = makeBlob();

function CSGToJson() {
  var str = '{ "type": "csg","polygons": [';
  var comma = '';
  CSG.polygons.map(function (polygon) {
    str += comma;
    str += JSON.stringify(polygon);
    comma = ',';
  });
  str += '],';
  str += '"isCanonicalized": ' + JSON.stringify(this.isCanonicalized) + ',';
  str += '"isRetesselated": ' + JSON.stringify(this.isRetesselated);
  str += '}';
  return new Blob$5([str], {
    type: 'application/json'
  });
}

var Blob$6 = makeBlob();

function CSGToStla(CSG) {
  var result = 'solid csg.js\n';
  CSG.polygons.map(function (p) {
    result += CSGPolygontoStlString(p);
  });
  result += 'endsolid csg.js\n';
  return new Blob$6([result], {
    type: 'application/sla'
  });
}

function CSGVector3DtoStlString(v) {
  return v._x + ' ' + v._y + ' ' + v._z;
}

function CSGVertextoStlString(vertex) {
  return 'vertex ' + CSGVector3DtoStlString(vertex.pos) + '\n';
}

function CSGPolygontoStlString(polygon) {
  var result = '';
  if (polygon.vertices.length >= 3) // should be!
    {
      // STL requires triangular polygons. If our polygon has more vertices, create
      // multiple triangles:
      var firstVertexStl = CSGVertextoStlString(polygon.vertices[0]);
      for (var i = 0; i < polygon.vertices.length - 2; i++) {
        result += 'facet normal ' + CSGVector3DtoStlString(polygon.plane.normal) + '\nouter loop\n';
        result += firstVertexStl;
        result += CSGVertextoStlString(polygon.vertices[i + 1]);
        result += CSGVertextoStlString(polygon.vertices[i + 2]);
        result += 'endloop\nendfacet\n';
      }
    }
  return result;
}

var Blob$7 = makeBlob();

// see http://en.wikipedia.org/wiki/STL_%28file_format%29#Binary_STL
function CSGToStlb(CSG) {
  // first check if the host is little-endian:
  var buffer = new ArrayBuffer(4);
  var int32buffer = new Int32Array(buffer, 0, 1);
  var int8buffer = new Int8Array(buffer, 0, 4);
  int32buffer[0] = 0x11223344;
  if (int8buffer[0] != 0x44) {
    throw new Error('Binary STL output is currently only supported on little-endian (Intel) processors');
  }

  var numtriangles = 0;
  CSG.polygons.map(function (p) {
    var numvertices = p.vertices.length;
    var thisnumtriangles = numvertices >= 3 ? numvertices - 2 : 0;
    numtriangles += thisnumtriangles;
  });
  var headerarray = new Uint8Array(80);
  for (var i = 0; i < 80; i++) {
    headerarray[i] = 65;
  }
  var ar1 = new Uint32Array(1);
  ar1[0] = numtriangles;
  // write the triangles to allTrianglesBuffer:
  var allTrianglesBuffer = new ArrayBuffer(50 * numtriangles);
  var allTrianglesBufferAsInt8 = new Int8Array(allTrianglesBuffer);
  // a tricky problem is that a Float32Array must be aligned at 4-byte boundaries (at least in certain browsers)
  // while each triangle takes 50 bytes. Therefore we write each triangle to a temporary buffer, and copy that
  // into allTrianglesBuffer:
  var triangleBuffer = new ArrayBuffer(50);
  var triangleBufferAsInt8 = new Int8Array(triangleBuffer);
  // each triangle consists of 12 floats:
  var triangleFloat32array = new Float32Array(triangleBuffer, 0, 12);
  // and one uint16:
  var triangleUint16array = new Uint16Array(triangleBuffer, 48, 1);
  var byteoffset = 0;
  CSG.polygons.map(function (p) {
    var numvertices = p.vertices.length;
    for (var i = 0; i < numvertices - 2; i++) {
      var normal = p.plane.normal;
      triangleFloat32array[0] = normal._x;
      triangleFloat32array[1] = normal._y;
      triangleFloat32array[2] = normal._z;
      var arindex = 3;
      for (var v = 0; v < 3; v++) {
        var vv = v + (v > 0 ? i : 0);
        var vertexpos = p.vertices[vv].pos;
        triangleFloat32array[arindex++] = vertexpos._x;
        triangleFloat32array[arindex++] = vertexpos._y;
        triangleFloat32array[arindex++] = vertexpos._z;
      }
      triangleUint16array[0] = 0;
      // copy the triangle into allTrianglesBuffer:
      allTrianglesBufferAsInt8.set(triangleBufferAsInt8, byteoffset);
      byteoffset += 50;
    }
  });
  return new Blob$7([headerarray.buffer, ar1.buffer, allTrianglesBuffer], {
    type: 'application/sla'
  });
}

function createCommonjsModule(fn, module) {
  return module = { exports: {} }, fn(module, module.exports), module.exports;
}

//[4]   	NameStartChar	   ::=   	":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
//[4a]   	NameChar	   ::=   	NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
//[5]   	Name	   ::=   	NameStartChar (NameChar)*
var nameStartChar = /[A-Z_a-z\xC0-\xD6\xD8-\xF6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/; //\u10000-\uEFFFF
var nameChar = new RegExp("[\\-\\.0-9" + nameStartChar.source.slice(1, -1) + '\\u00B7\\u0300-\\u036F\\u203F-\\u2040]');
var tagNamePattern = new RegExp('^' + nameStartChar.source + nameChar.source + '*(?:\:' + nameStartChar.source + nameChar.source + '*)?$');
//var tagNamePattern = /^[a-zA-Z_][\w\-\.]*(?:\:[a-zA-Z_][\w\-\.]*)?$/
//var handlers = 'resolveEntity,getExternalSubset,characters,endDocument,endElement,endPrefixMapping,ignorableWhitespace,processingInstruction,setDocumentLocator,skippedEntity,startDocument,startElement,startPrefixMapping,notationDecl,unparsedEntityDecl,error,fatalError,warning,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,comment,endCDATA,endDTD,endEntity,startCDATA,startDTD,startEntity'.split(',')

//S_TAG,	S_ATTR,	S_EQ,	S_ATTR_NOQUOT_VALUE
//S_ATTR_SPACE,	S_ATTR_END,	S_TAG_SPACE, S_TAG_CLOSE
var S_TAG = 0; //tag name offerring
var S_ATTR = 1; //attr name offerring 
var S_ATTR_SPACE = 2; //attr name end and space offer
var S_EQ = 3; //=space?
var S_ATTR_NOQUOT_VALUE = 4; //attr value(no quot value only)
var S_ATTR_END = 5; //attr value end and no space(quot end)
var S_TAG_SPACE = 6; //(attr value end || tag end ) && (space offer)
var S_TAG_CLOSE = 7; //closed el<el />

function XMLReader() {}

XMLReader.prototype = {
  parse: function parse(source, defaultNSMap, entityMap) {
    var domBuilder = this.domBuilder;
    domBuilder.startDocument();
    _copy(defaultNSMap, defaultNSMap = {});
    _parse(source, defaultNSMap, entityMap, domBuilder, this.errorHandler);
    domBuilder.endDocument();
  }
};
function _parse(source, defaultNSMapCopy, entityMap, domBuilder, errorHandler) {
  function fixedFromCharCode(code) {
    // String.prototype.fromCharCode does not supports
    // > 2 bytes unicode chars directly
    if (code > 0xffff) {
      code -= 0x10000;
      var surrogate1 = 0xd800 + (code >> 10),
          surrogate2 = 0xdc00 + (code & 0x3ff);

      return String.fromCharCode(surrogate1, surrogate2);
    } else {
      return String.fromCharCode(code);
    }
  }
  function entityReplacer(a) {
    var k = a.slice(1, -1);
    if (k in entityMap) {
      return entityMap[k];
    } else if (k.charAt(0) === '#') {
      return fixedFromCharCode(parseInt(k.substr(1).replace('x', '0x')));
    } else {
      errorHandler.error('entity not found:' + a);
      return a;
    }
  }
  function appendText(end) {
    //has some bugs
    if (end > start) {
      var xt = source.substring(start, end).replace(/&#?\w+;/g, entityReplacer);
      locator && position(start);
      domBuilder.characters(xt, 0, end - start);
      start = end;
    }
  }
  function position(p, m) {
    while (p >= lineEnd && (m = linePattern.exec(source))) {
      lineStart = m.index;
      lineEnd = lineStart + m[0].length;
      locator.lineNumber++;
      //console.log('line++:',locator,startPos,endPos)
    }
    locator.columnNumber = p - lineStart + 1;
  }
  var lineStart = 0;
  var lineEnd = 0;
  var linePattern = /.*(?:\r\n?|\n)|.*$/g;
  var locator = domBuilder.locator;

  var parseStack = [{ currentNSMap: defaultNSMapCopy }];
  var closeMap = {};
  var start = 0;
  while (true) {
    try {
      var tagStart = source.indexOf('<', start);
      if (tagStart < 0) {
        if (!source.substr(start).match(/^\s*$/)) {
          var doc = domBuilder.doc;
          var text = doc.createTextNode(source.substr(start));
          doc.appendChild(text);
          domBuilder.currentElement = text;
        }
        return;
      }
      if (tagStart > start) {
        appendText(tagStart);
      }
      switch (source.charAt(tagStart + 1)) {
        case '/':
          var end = source.indexOf('>', tagStart + 3);
          var tagName = source.substring(tagStart + 2, end);
          var config = parseStack.pop();
          if (end < 0) {

            tagName = source.substring(tagStart + 2).replace(/[\s<].*/, '');
            //console.error('#@@@@@@'+tagName)
            errorHandler.error("end tag name: " + tagName + ' is not complete:' + config.tagName);
            end = tagStart + 1 + tagName.length;
          } else if (tagName.match(/\s</)) {
            tagName = tagName.replace(/[\s<].*/, '');
            errorHandler.error("end tag name: " + tagName + ' maybe not complete');
            end = tagStart + 1 + tagName.length;
          }
          //console.error(parseStack.length,parseStack)
          //console.error(config);
          var localNSMap = config.localNSMap;
          var endMatch = config.tagName == tagName;
          var endIgnoreCaseMach = endMatch || config.tagName && config.tagName.toLowerCase() == tagName.toLowerCase();
          if (endIgnoreCaseMach) {
            domBuilder.endElement(config.uri, config.localName, tagName);
            if (localNSMap) {
              for (var prefix in localNSMap) {
                domBuilder.endPrefixMapping(prefix);
              }
            }
            if (!endMatch) {
              errorHandler.fatalError("end tag name: " + tagName + ' is not match the current start tagName:' + config.tagName);
            }
          } else {
            parseStack.push(config);
          }

          end++;
          break;
        // end elment
        case '?':
          // <?...?>
          locator && position(tagStart);
          end = parseInstruction(source, tagStart, domBuilder);
          break;
        case '!':
          // <!doctype,<![CDATA,<!--
          locator && position(tagStart);
          end = parseDCC(source, tagStart, domBuilder, errorHandler);
          break;
        default:
          locator && position(tagStart);
          var el = new ElementAttributes();
          var currentNSMap = parseStack[parseStack.length - 1].currentNSMap;
          //elStartEnd
          var end = parseElementStartPart(source, tagStart, el, currentNSMap, entityReplacer, errorHandler);
          var len = el.length;

          if (!el.closed && fixSelfClosed(source, end, el.tagName, closeMap)) {
            el.closed = true;
            if (!entityMap.nbsp) {
              errorHandler.warning('unclosed xml attribute');
            }
          }
          if (locator && len) {
            var locator2 = copyLocator(locator, {});
            //try{//attribute position fixed
            for (var i = 0; i < len; i++) {
              var a = el[i];
              position(a.offset);
              a.locator = copyLocator(locator, {});
            }
            //}catch(e){console.error('@@@@@'+e)}
            domBuilder.locator = locator2;
            if (appendElement(el, domBuilder, currentNSMap)) {
              parseStack.push(el);
            }
            domBuilder.locator = locator;
          } else {
            if (appendElement(el, domBuilder, currentNSMap)) {
              parseStack.push(el);
            }
          }

          if (el.uri === 'http://www.w3.org/1999/xhtml' && !el.closed) {
            end = parseHtmlSpecialContent(source, end, el.tagName, entityReplacer, domBuilder);
          } else {
            end++;
          }
      }
    } catch (e) {
      errorHandler.error('element parse error: ' + e);
      //errorHandler.error('element parse error: '+e);
      end = -1;
      //throw e;
    }
    if (end > start) {
      start = end;
    } else {
      //TODO: 这里有可能sax回退，有位置错误风险
      appendText(Math.max(tagStart, start) + 1);
    }
  }
}
function copyLocator(f, t) {
  t.lineNumber = f.lineNumber;
  t.columnNumber = f.columnNumber;
  return t;
}

/**
 * @see #appendElement(source,elStartEnd,el,selfClosed,entityReplacer,domBuilder,parseStack);
 * @return end of the elementStartPart(end of elementEndPart for selfClosed el)
 */
function parseElementStartPart(source, start, el, currentNSMap, entityReplacer, errorHandler) {
  var attrName;
  var value;
  var p = ++start;
  var s = S_TAG; //status
  while (true) {
    var c = source.charAt(p);
    switch (c) {
      case '=':
        if (s === S_ATTR) {
          //attrName
          attrName = source.slice(start, p);
          s = S_EQ;
        } else if (s === S_ATTR_SPACE) {
          s = S_EQ;
        } else {
          //fatalError: equal must after attrName or space after attrName
          throw new Error('attribute equal must after attrName');
        }
        break;
      case '\'':
      case '"':
        if (s === S_EQ || s === S_ATTR //|| s == S_ATTR_SPACE
        ) {
            //equal
            if (s === S_ATTR) {
              errorHandler.warning('attribute value must after "="');
              attrName = source.slice(start, p);
            }
            start = p + 1;
            p = source.indexOf(c, start);
            if (p > 0) {
              value = source.slice(start, p).replace(/&#?\w+;/g, entityReplacer);
              el.add(attrName, value, start - 1);
              s = S_ATTR_END;
            } else {
              //fatalError: no end quot match
              throw new Error('attribute value no end \'' + c + '\' match');
            }
          } else if (s == S_ATTR_NOQUOT_VALUE) {
          value = source.slice(start, p).replace(/&#?\w+;/g, entityReplacer);
          //console.log(attrName,value,start,p)
          el.add(attrName, value, start);
          //console.dir(el)
          errorHandler.warning('attribute "' + attrName + '" missed start quot(' + c + ')!!');
          start = p + 1;
          s = S_ATTR_END;
        } else {
          //fatalError: no equal before
          throw new Error('attribute value must after "="');
        }
        break;
      case '/':
        switch (s) {
          case S_TAG:
            el.setTagName(source.slice(start, p));
          case S_ATTR_END:
          case S_TAG_SPACE:
          case S_TAG_CLOSE:
            s = S_TAG_CLOSE;
            el.closed = true;
          case S_ATTR_NOQUOT_VALUE:
          case S_ATTR:
          case S_ATTR_SPACE:
            break;
          //case S_EQ:
          default:
            throw new Error("attribute invalid close char('/')");
        }
        break;
      case '':
        //end document
        //throw new Error('unexpected end of input')
        errorHandler.error('unexpected end of input');
        if (s == S_TAG) {
          el.setTagName(source.slice(start, p));
        }
        return p;
      case '>':
        switch (s) {
          case S_TAG:
            el.setTagName(source.slice(start, p));
          case S_ATTR_END:
          case S_TAG_SPACE:
          case S_TAG_CLOSE:
            break; //normal
          case S_ATTR_NOQUOT_VALUE: //Compatible state
          case S_ATTR:
            value = source.slice(start, p);
            if (value.slice(-1) === '/') {
              el.closed = true;
              value = value.slice(0, -1);
            }
          case S_ATTR_SPACE:
            if (s === S_ATTR_SPACE) {
              value = attrName;
            }
            if (s == S_ATTR_NOQUOT_VALUE) {
              errorHandler.warning('attribute "' + value + '" missed quot(")!!');
              el.add(attrName, value.replace(/&#?\w+;/g, entityReplacer), start);
            } else {
              if (currentNSMap[''] !== 'http://www.w3.org/1999/xhtml' || !value.match(/^(?:disabled|checked|selected)$/i)) {
                errorHandler.warning('attribute "' + value + '" missed value!! "' + value + '" instead!!');
              }
              el.add(value, value, start);
            }
            break;
          case S_EQ:
            throw new Error('attribute value missed!!');
        }
        //			console.log(tagName,tagNamePattern,tagNamePattern.test(tagName))
        return p;
      /*xml space '\x20' | #x9 | #xD | #xA; */
      case '\x80':
        c = ' ';
      default:
        if (c <= ' ') {
          //space
          switch (s) {
            case S_TAG:
              el.setTagName(source.slice(start, p)); //tagName
              s = S_TAG_SPACE;
              break;
            case S_ATTR:
              attrName = source.slice(start, p);
              s = S_ATTR_SPACE;
              break;
            case S_ATTR_NOQUOT_VALUE:
              var value = source.slice(start, p).replace(/&#?\w+;/g, entityReplacer);
              errorHandler.warning('attribute "' + value + '" missed quot(")!!');
              el.add(attrName, value, start);
            case S_ATTR_END:
              s = S_TAG_SPACE;
              break;
            //case S_TAG_SPACE:
            //case S_EQ:
            //case S_ATTR_SPACE:
            //	void();break;
            //case S_TAG_CLOSE:
            //ignore warning
          }
        } else {
          //not space
          //S_TAG,	S_ATTR,	S_EQ,	S_ATTR_NOQUOT_VALUE
          //S_ATTR_SPACE,	S_ATTR_END,	S_TAG_SPACE, S_TAG_CLOSE
          switch (s) {
            //case S_TAG:void();break;
            //case S_ATTR:void();break;
            //case S_ATTR_NOQUOT_VALUE:void();break;
            case S_ATTR_SPACE:
              var tagName = el.tagName;
              if (currentNSMap[''] !== 'http://www.w3.org/1999/xhtml' || !attrName.match(/^(?:disabled|checked|selected)$/i)) {
                errorHandler.warning('attribute "' + attrName + '" missed value!! "' + attrName + '" instead2!!');
              }
              el.add(attrName, attrName, start);
              start = p;
              s = S_ATTR;
              break;
            case S_ATTR_END:
              errorHandler.warning('attribute space is required"' + attrName + '"!!');
            case S_TAG_SPACE:
              s = S_ATTR;
              start = p;
              break;
            case S_EQ:
              s = S_ATTR_NOQUOT_VALUE;
              start = p;
              break;
            case S_TAG_CLOSE:
              throw new Error("elements closed character '/' and '>' must be connected to");
          }
        }
    } //end outer switch
    //console.log('p++',p)
    p++;
  }
}
/**
 * @return true if has new namespace define
 */
function appendElement(el, domBuilder, currentNSMap) {
  var tagName = el.tagName;
  var localNSMap = null;
  //var currentNSMap = parseStack[parseStack.length-1].currentNSMap;
  var i = el.length;
  while (i--) {
    var a = el[i];
    var qName = a.qName;
    var value = a.value;
    var nsp = qName.indexOf(':');
    if (nsp > 0) {
      var prefix = a.prefix = qName.slice(0, nsp);
      var localName = qName.slice(nsp + 1);
      var nsPrefix = prefix === 'xmlns' && localName;
    } else {
      localName = qName;
      prefix = null;
      nsPrefix = qName === 'xmlns' && '';
    }
    //can not set prefix,because prefix !== ''
    a.localName = localName;
    //prefix == null for no ns prefix attribute 
    if (nsPrefix !== false) {
      //hack!!
      if (localNSMap == null) {
        localNSMap = {};
        //console.log(currentNSMap,0)
        _copy(currentNSMap, currentNSMap = {});
        //console.log(currentNSMap,1)
      }
      currentNSMap[nsPrefix] = localNSMap[nsPrefix] = value;
      a.uri = 'http://www.w3.org/2000/xmlns/';
      domBuilder.startPrefixMapping(nsPrefix, value);
    }
  }
  var i = el.length;
  while (i--) {
    a = el[i];
    var prefix = a.prefix;
    if (prefix) {
      //no prefix attribute has no namespace
      if (prefix === 'xml') {
        a.uri = 'http://www.w3.org/XML/1998/namespace';
      }if (prefix !== 'xmlns') {
        a.uri = currentNSMap[prefix || ''];

        //{console.log('###'+a.qName,domBuilder.locator.systemId+'',currentNSMap,a.uri)}
      }
    }
  }
  var nsp = tagName.indexOf(':');
  if (nsp > 0) {
    prefix = el.prefix = tagName.slice(0, nsp);
    localName = el.localName = tagName.slice(nsp + 1);
  } else {
    prefix = null; //important!!
    localName = el.localName = tagName;
  }
  //no prefix element has default namespace
  var ns = el.uri = currentNSMap[prefix || ''];
  domBuilder.startElement(ns, localName, tagName, el);
  //endPrefixMapping and startPrefixMapping have not any help for dom builder
  //localNSMap = null
  if (el.closed) {
    domBuilder.endElement(ns, localName, tagName);
    if (localNSMap) {
      for (prefix in localNSMap) {
        domBuilder.endPrefixMapping(prefix);
      }
    }
  } else {
    el.currentNSMap = currentNSMap;
    el.localNSMap = localNSMap;
    //parseStack.push(el);
    return true;
  }
}
function parseHtmlSpecialContent(source, elStartEnd, tagName, entityReplacer, domBuilder) {
  if (/^(?:script|textarea)$/i.test(tagName)) {
    var elEndStart = source.indexOf('</' + tagName + '>', elStartEnd);
    var text = source.substring(elStartEnd + 1, elEndStart);
    if (/[&<]/.test(text)) {
      if (/^script$/i.test(tagName)) {
        //if(!/\]\]>/.test(text)){
        //lexHandler.startCDATA();
        domBuilder.characters(text, 0, text.length);
        //lexHandler.endCDATA();
        return elEndStart;
        //}
      } //}else{//text area
      text = text.replace(/&#?\w+;/g, entityReplacer);
      domBuilder.characters(text, 0, text.length);
      return elEndStart;
      //}
    }
  }
  return elStartEnd + 1;
}
function fixSelfClosed(source, elStartEnd, tagName, closeMap) {
  //if(tagName in closeMap){
  var pos = closeMap[tagName];
  if (pos == null) {
    //console.log(tagName)
    pos = source.lastIndexOf('</' + tagName + '>');
    if (pos < elStartEnd) {
      //忘记闭合
      pos = source.lastIndexOf('</' + tagName);
    }
    closeMap[tagName] = pos;
  }
  return pos < elStartEnd;
  //} 
}
function _copy(source, target) {
  for (var n in source) {
    target[n] = source[n];
  }
}
function parseDCC(source, start, domBuilder, errorHandler) {
  //sure start with '<!'
  var next = source.charAt(start + 2);
  switch (next) {
    case '-':
      if (source.charAt(start + 3) === '-') {
        var end = source.indexOf('-->', start + 4);
        //append comment source.substring(4,end)//<!--
        if (end > start) {
          domBuilder.comment(source, start + 4, end - start - 4);
          return end + 3;
        } else {
          errorHandler.error("Unclosed comment");
          return -1;
        }
      } else {
        //error
        return -1;
      }
    default:
      if (source.substr(start + 3, 6) == 'CDATA[') {
        var end = source.indexOf(']]>', start + 9);
        domBuilder.startCDATA();
        domBuilder.characters(source, start + 9, end - start - 9);
        domBuilder.endCDATA();
        return end + 3;
      }
      //<!DOCTYPE
      //startDTD(java.lang.String name, java.lang.String publicId, java.lang.String systemId) 
      var matchs = split(source, start);
      var len = matchs.length;
      if (len > 1 && /!doctype/i.test(matchs[0][0])) {
        var name = matchs[1][0];
        var pubid = len > 3 && /^public$/i.test(matchs[2][0]) && matchs[3][0];
        var sysid = len > 4 && matchs[4][0];
        var lastMatch = matchs[len - 1];
        domBuilder.startDTD(name, pubid && pubid.replace(/^(['"])(.*?)\1$/, '$2'), sysid && sysid.replace(/^(['"])(.*?)\1$/, '$2'));
        domBuilder.endDTD();

        return lastMatch.index + lastMatch[0].length;
      }
  }
  return -1;
}

function parseInstruction(source, start, domBuilder) {
  var end = source.indexOf('?>', start);
  if (end) {
    var match = source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)\s*$/);
    if (match) {
      var len = match[0].length;
      domBuilder.processingInstruction(match[1], match[2]);
      return end + 2;
    } else {
      //error
      return -1;
    }
  }
  return -1;
}

/**
 * @param source
 */
function ElementAttributes(source) {}
ElementAttributes.prototype = {
  setTagName: function setTagName(tagName) {
    if (!tagNamePattern.test(tagName)) {
      throw new Error('invalid tagName:' + tagName);
    }
    this.tagName = tagName;
  },
  add: function add(qName, value, offset) {
    if (!tagNamePattern.test(qName)) {
      throw new Error('invalid attribute:' + qName);
    }
    this[this.length++] = { qName: qName, value: value, offset: offset };
  },
  length: 0,
  getLocalName: function getLocalName(i) {
    return this[i].localName;
  },
  getLocator: function getLocator(i) {
    return this[i].locator;
  },
  getQName: function getQName(i) {
    return this[i].qName;
  },
  getURI: function getURI(i) {
    return this[i].uri;
  },
  getValue: function getValue(i) {
    return this[i].value;
  }
  //	,getIndex:function(uri, localName)){
  //		if(localName){
  //			
  //		}else{
  //			var qName = uri
  //		}
  //	},
  //	getValue:function(){return this.getValue(this.getIndex.apply(this,arguments))},
  //	getType:function(uri,localName){}
  //	getType:function(i){},
};

function _set_proto_(thiz, parent) {
  thiz.__proto__ = parent;
  return thiz;
}
if (!(_set_proto_({}, _set_proto_.prototype) instanceof _set_proto_)) {
  _set_proto_ = function _set_proto_(thiz, parent) {
    function p() {}
    p.prototype = parent;
    p = new p();
    for (parent in thiz) {
      p[parent] = thiz[parent];
    }
    return p;
  };
}

function split(source, start) {
  var match;
  var buf = [];
  var reg = /'[^']+'|"[^"]+"|[^\s<>\/=]+=?|(\/?\s*>|<)/g;
  reg.lastIndex = start;
  reg.exec(source); //skip <
  while (match = reg.exec(source)) {
    buf.push(match);
    if (match[1]) {
      return buf;
    }
  }
}

var XMLReader_1 = XMLReader;

var sax = {
  XMLReader: XMLReader_1
};

/*
 * DOM Level 2
 * Object DOMException
 * @see http://www.w3.org/TR/REC-DOM-Level-1/ecma-script-language-binding.html
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/ecma-script-binding.html
 */

function copy(src, dest) {
  for (var p in src) {
    dest[p] = src[p];
  }
}
/**
^\w+\.prototype\.([_\w]+)\s*=\s*((?:.*\{\s*?[\r\n][\s\S]*?^})|\S.*?(?=[;\r\n]));?
^\w+\.prototype\.([_\w]+)\s*=\s*(\S.*?(?=[;\r\n]));?
 */
function _extends(Class, Super) {
  var pt = Class.prototype;
  if (Object.create) {
    var ppt = Object.create(Super.prototype);
    pt.__proto__ = ppt;
  }
  if (!(pt instanceof Super)) {
    var t = function t() {};

    t.prototype = Super.prototype;
    t = new t();
    copy(pt, t);
    Class.prototype = pt = t;
  }
  if (pt.constructor != Class) {
    if (typeof Class != 'function') {
      console.error("unknow Class:" + Class);
    }
    pt.constructor = Class;
  }
}
var htmlns = 'http://www.w3.org/1999/xhtml';
// Node Types
var NodeType = {};
var ELEMENT_NODE = NodeType.ELEMENT_NODE = 1;
var ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE = 2;
var TEXT_NODE = NodeType.TEXT_NODE = 3;
var CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE = 4;
var ENTITY_REFERENCE_NODE = NodeType.ENTITY_REFERENCE_NODE = 5;
var ENTITY_NODE = NodeType.ENTITY_NODE = 6;
var PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE = 7;
var COMMENT_NODE = NodeType.COMMENT_NODE = 8;
var DOCUMENT_NODE = NodeType.DOCUMENT_NODE = 9;
var DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE = 10;
var DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE = 11;
var NOTATION_NODE = NodeType.NOTATION_NODE = 12;

// ExceptionCode
var ExceptionCode = {};
var ExceptionMessage = {};
var INDEX_SIZE_ERR = ExceptionCode.INDEX_SIZE_ERR = (ExceptionMessage[1] = "Index size error", 1);
var DOMSTRING_SIZE_ERR = ExceptionCode.DOMSTRING_SIZE_ERR = (ExceptionMessage[2] = "DOMString size error", 2);
var HIERARCHY_REQUEST_ERR = ExceptionCode.HIERARCHY_REQUEST_ERR = (ExceptionMessage[3] = "Hierarchy request error", 3);
var WRONG_DOCUMENT_ERR = ExceptionCode.WRONG_DOCUMENT_ERR = (ExceptionMessage[4] = "Wrong document", 4);
var INVALID_CHARACTER_ERR = ExceptionCode.INVALID_CHARACTER_ERR = (ExceptionMessage[5] = "Invalid character", 5);
var NO_DATA_ALLOWED_ERR = ExceptionCode.NO_DATA_ALLOWED_ERR = (ExceptionMessage[6] = "No data allowed", 6);
var NO_MODIFICATION_ALLOWED_ERR = ExceptionCode.NO_MODIFICATION_ALLOWED_ERR = (ExceptionMessage[7] = "No modification allowed", 7);
var NOT_FOUND_ERR = ExceptionCode.NOT_FOUND_ERR = (ExceptionMessage[8] = "Not found", 8);
var NOT_SUPPORTED_ERR = ExceptionCode.NOT_SUPPORTED_ERR = (ExceptionMessage[9] = "Not supported", 9);
var INUSE_ATTRIBUTE_ERR = ExceptionCode.INUSE_ATTRIBUTE_ERR = (ExceptionMessage[10] = "Attribute in use", 10);
//level2
var INVALID_STATE_ERR = ExceptionCode.INVALID_STATE_ERR = (ExceptionMessage[11] = "Invalid state", 11);
var SYNTAX_ERR = ExceptionCode.SYNTAX_ERR = (ExceptionMessage[12] = "Syntax error", 12);
var INVALID_MODIFICATION_ERR = ExceptionCode.INVALID_MODIFICATION_ERR = (ExceptionMessage[13] = "Invalid modification", 13);
var NAMESPACE_ERR = ExceptionCode.NAMESPACE_ERR = (ExceptionMessage[14] = "Invalid namespace", 14);
var INVALID_ACCESS_ERR = ExceptionCode.INVALID_ACCESS_ERR = (ExceptionMessage[15] = "Invalid access", 15);

function DOMException(code, message) {
  if (message instanceof Error) {
    var error = message;
  } else {
    error = this;
    Error.call(this, ExceptionMessage[code]);
    this.message = ExceptionMessage[code];
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DOMException);
    }
  }
  error.code = code;
  if (message) {
    this.message = this.message + ": " + message;
  }
  return error;
}
DOMException.prototype = Error.prototype;
copy(ExceptionCode, DOMException);
/**
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/core.html#ID-536297177
 * The NodeList interface provides the abstraction of an ordered collection of nodes, without defining or constraining how this collection is implemented. NodeList objects in the DOM are live.
 * The items in the NodeList are accessible via an integral index, starting from 0.
 */
function NodeList() {}
NodeList.prototype = {
  /**
   * The number of nodes in the list. The range of valid child node indices is 0 to length-1 inclusive.
   * @standard level1
   */
  length: 0,
  /**
   * Returns the indexth item in the collection. If index is greater than or equal to the number of nodes in the list, this returns null.
   * @standard level1
   * @param index  unsigned long 
   *   Index into the collection.
   * @return Node
   * 	The node at the indexth position in the NodeList, or null if that is not a valid index. 
   */
  item: function item(index) {
    return this[index] || null;
  },
  toString: function toString(isHTML, nodeFilter) {
    var this$1 = this;

    for (var buf = [], i = 0; i < this.length; i++) {
      serializeToString(this$1[i], buf, isHTML, nodeFilter);
    }
    return buf.join('');
  }
};
function LiveNodeList(node, refresh) {
  this._node = node;
  this._refresh = refresh;
  _updateLiveList(this);
}
function _updateLiveList(list) {
  var inc = list._node._inc || list._node.ownerDocument._inc;
  if (list._inc != inc) {
    var ls = list._refresh(list._node);
    //console.log(ls.length)
    __set__(list, 'length', ls.length);
    copy(ls, list);
    list._inc = inc;
  }
}
LiveNodeList.prototype.item = function (i) {
  _updateLiveList(this);
  return this[i];
};

_extends(LiveNodeList, NodeList);
/**
 * 
 * Objects implementing the NamedNodeMap interface are used to represent collections of nodes that can be accessed by name. Note that NamedNodeMap does not inherit from NodeList; NamedNodeMaps are not maintained in any particular order. Objects contained in an object implementing NamedNodeMap may also be accessed by an ordinal index, but this is simply to allow convenient enumeration of the contents of a NamedNodeMap, and does not imply that the DOM specifies an order to these Nodes.
 * NamedNodeMap objects in the DOM are live.
 * used for attributes or DocumentType entities 
 */
function NamedNodeMap() {}

function _findNodeIndex(list, node) {
  var i = list.length;
  while (i--) {
    if (list[i] === node) {
      return i;
    }
  }
}

function _addNamedNode(el, list, newAttr, oldAttr) {
  if (oldAttr) {
    list[_findNodeIndex(list, oldAttr)] = newAttr;
  } else {
    list[list.length++] = newAttr;
  }
  if (el) {
    newAttr.ownerElement = el;
    var doc = el.ownerDocument;
    if (doc) {
      oldAttr && _onRemoveAttribute(doc, el, oldAttr);
      _onAddAttribute(doc, el, newAttr);
    }
  }
}
function _removeNamedNode(el, list, attr) {
  //console.log('remove attr:'+attr)
  var i = _findNodeIndex(list, attr);
  if (i >= 0) {
    var lastIndex = list.length - 1;
    while (i < lastIndex) {
      list[i] = list[++i];
    }
    list.length = lastIndex;
    if (el) {
      var doc = el.ownerDocument;
      if (doc) {
        _onRemoveAttribute(doc, el, attr);
        attr.ownerElement = null;
      }
    }
  } else {
    throw DOMException(NOT_FOUND_ERR, new Error(el.tagName + '@' + attr));
  }
}
NamedNodeMap.prototype = {
  length: 0,
  item: NodeList.prototype.item,
  getNamedItem: function getNamedItem(key) {
    var this$1 = this;

    //		if(key.indexOf(':')>0 || key == 'xmlns'){
    //			return null;
    //		}
    //console.log()
    var i = this.length;
    while (i--) {
      var attr = this$1[i];
      //console.log(attr.nodeName,key)
      if (attr.nodeName == key) {
        return attr;
      }
    }
  },
  setNamedItem: function setNamedItem(attr) {
    var el = attr.ownerElement;
    if (el && el != this._ownerElement) {
      throw new DOMException(INUSE_ATTRIBUTE_ERR);
    }
    var oldAttr = this.getNamedItem(attr.nodeName);
    _addNamedNode(this._ownerElement, this, attr, oldAttr);
    return oldAttr;
  },
  /* returns Node */
  setNamedItemNS: function setNamedItemNS(attr) {
    // raises: WRONG_DOCUMENT_ERR,NO_MODIFICATION_ALLOWED_ERR,INUSE_ATTRIBUTE_ERR
    var el = attr.ownerElement,
        oldAttr;
    if (el && el != this._ownerElement) {
      throw new DOMException(INUSE_ATTRIBUTE_ERR);
    }
    oldAttr = this.getNamedItemNS(attr.namespaceURI, attr.localName);
    _addNamedNode(this._ownerElement, this, attr, oldAttr);
    return oldAttr;
  },

  /* returns Node */
  removeNamedItem: function removeNamedItem(key) {
    var attr = this.getNamedItem(key);
    _removeNamedNode(this._ownerElement, this, attr);
    return attr;
  }, // raises: NOT_FOUND_ERR,NO_MODIFICATION_ALLOWED_ERR

  //for level2
  removeNamedItemNS: function removeNamedItemNS(namespaceURI, localName) {
    var attr = this.getNamedItemNS(namespaceURI, localName);
    _removeNamedNode(this._ownerElement, this, attr);
    return attr;
  },
  getNamedItemNS: function getNamedItemNS(namespaceURI, localName) {
    var this$1 = this;

    var i = this.length;
    while (i--) {
      var node = this$1[i];
      if (node.localName == localName && node.namespaceURI == namespaceURI) {
        return node;
      }
    }
    return null;
  }
};
/**
 * @see http://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-102161490
 */
function DOMImplementation( /* Object */features) {
  var this$1 = this;

  this._features = {};
  if (features) {
    for (var feature in features) {
      this$1._features = features[feature];
    }
  }
}

DOMImplementation.prototype = {
  hasFeature: function hasFeature( /* string */feature, /* string */version) {
    var versions = this._features[feature.toLowerCase()];
    if (versions && (!version || version in versions)) {
      return true;
    } else {
      return false;
    }
  },
  // Introduced in DOM Level 2:
  createDocument: function createDocument(namespaceURI, qualifiedName, doctype) {
    // raises:INVALID_CHARACTER_ERR,NAMESPACE_ERR,WRONG_DOCUMENT_ERR
    var doc = new Document();
    doc.implementation = this;
    doc.childNodes = new NodeList();
    doc.doctype = doctype;
    if (doctype) {
      doc.appendChild(doctype);
    }
    if (qualifiedName) {
      var root = doc.createElementNS(namespaceURI, qualifiedName);
      doc.appendChild(root);
    }
    return doc;
  },
  // Introduced in DOM Level 2:
  createDocumentType: function createDocumentType(qualifiedName, publicId, systemId) {
    // raises:INVALID_CHARACTER_ERR,NAMESPACE_ERR
    var node = new DocumentType();
    node.name = qualifiedName;
    node.nodeName = qualifiedName;
    node.publicId = publicId;
    node.systemId = systemId;
    // Introduced in DOM Level 2:
    //readonly attribute DOMString        internalSubset;

    //TODO:..
    //  readonly attribute NamedNodeMap     entities;
    //  readonly attribute NamedNodeMap     notations;
    return node;
  }
};

/**
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/core.html#ID-1950641247
 */

function Node() {}

Node.prototype = {
  firstChild: null,
  lastChild: null,
  previousSibling: null,
  nextSibling: null,
  attributes: null,
  parentNode: null,
  childNodes: null,
  ownerDocument: null,
  nodeValue: null,
  namespaceURI: null,
  prefix: null,
  localName: null,
  // Modified in DOM Level 2:
  insertBefore: function insertBefore(newChild, refChild) {
    //raises 
    return _insertBefore(this, newChild, refChild);
  },
  replaceChild: function replaceChild(newChild, oldChild) {
    //raises 
    this.insertBefore(newChild, oldChild);
    if (oldChild) {
      this.removeChild(oldChild);
    }
  },
  removeChild: function removeChild(oldChild) {
    return _removeChild(this, oldChild);
  },
  appendChild: function appendChild(newChild) {
    return this.insertBefore(newChild, null);
  },
  hasChildNodes: function hasChildNodes() {
    return this.firstChild != null;
  },
  cloneNode: function cloneNode(deep) {
    return _cloneNode(this.ownerDocument || this, this, deep);
  },
  // Modified in DOM Level 2:
  normalize: function normalize() {
    var this$1 = this;

    var child = this.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (next && next.nodeType == TEXT_NODE && child.nodeType == TEXT_NODE) {
        this$1.removeChild(next);
        child.appendData(next.data);
      } else {
        child.normalize();
        child = next;
      }
    }
  },
  // Introduced in DOM Level 2:
  isSupported: function isSupported(feature, version) {
    return this.ownerDocument.implementation.hasFeature(feature, version);
  },
  // Introduced in DOM Level 2:
  hasAttributes: function hasAttributes() {
    return this.attributes.length > 0;
  },
  lookupPrefix: function lookupPrefix(namespaceURI) {
    var el = this;
    while (el) {
      var map = el._nsMap;
      //console.dir(map)
      if (map) {
        for (var n in map) {
          if (map[n] == namespaceURI) {
            return n;
          }
        }
      }
      el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
    }
    return null;
  },
  // Introduced in DOM Level 3:
  lookupNamespaceURI: function lookupNamespaceURI(prefix) {
    var el = this;
    while (el) {
      var map = el._nsMap;
      //console.dir(map)
      if (map) {
        if (prefix in map) {
          return map[prefix];
        }
      }
      el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
    }
    return null;
  },
  // Introduced in DOM Level 3:
  isDefaultNamespace: function isDefaultNamespace(namespaceURI) {
    var prefix = this.lookupPrefix(namespaceURI);
    return prefix == null;
  }
};

function _xmlEncoder(c) {
  return c == '<' && '&lt;' || c == '>' && '&gt;' || c == '&' && '&amp;' || c == '"' && '&quot;' || '&#' + c.charCodeAt() + ';';
}

copy(NodeType, Node);
copy(NodeType, Node.prototype);

/**
 * @param callback return true for continue,false for break
 * @return boolean true: break visit;
 */
function _visitNode(node, callback) {
  if (callback(node)) {
    return true;
  }
  if (node = node.firstChild) {
    do {
      if (_visitNode(node, callback)) {
        return true;
      }
    } while (node = node.nextSibling);
  }
}

function Document() {}
function _onAddAttribute(doc, el, newAttr) {
  doc && doc._inc++;
  var ns = newAttr.namespaceURI;
  if (ns == 'http://www.w3.org/2000/xmlns/') {
    //update namespace
    el._nsMap[newAttr.prefix ? newAttr.localName : ''] = newAttr.value;
  }
}
function _onRemoveAttribute(doc, el, newAttr, remove) {
  doc && doc._inc++;
  var ns = newAttr.namespaceURI;
  if (ns == 'http://www.w3.org/2000/xmlns/') {
    //update namespace
    delete el._nsMap[newAttr.prefix ? newAttr.localName : ''];
  }
}
function _onUpdateChild(doc, el, newChild) {
  if (doc && doc._inc) {
    doc._inc++;
    //update childNodes
    var cs = el.childNodes;
    if (newChild) {
      cs[cs.length++] = newChild;
    } else {
      //console.log(1)
      var child = el.firstChild;
      var i = 0;
      while (child) {
        cs[i++] = child;
        child = child.nextSibling;
      }
      cs.length = i;
    }
  }
}

/**
 * attributes;
 * children;
 * 
 * writeable properties:
 * nodeValue,Attr:value,CharacterData:data
 * prefix
 */
function _removeChild(parentNode, child) {
  var previous = child.previousSibling;
  var next = child.nextSibling;
  if (previous) {
    previous.nextSibling = next;
  } else {
    parentNode.firstChild = next;
  }
  if (next) {
    next.previousSibling = previous;
  } else {
    parentNode.lastChild = previous;
  }
  _onUpdateChild(parentNode.ownerDocument, parentNode);
  return child;
}
/**
 * preformance key(refChild == null)
 */
function _insertBefore(parentNode, newChild, nextChild) {
  var cp = newChild.parentNode;
  if (cp) {
    cp.removeChild(newChild); //remove and update
  }
  if (newChild.nodeType === DOCUMENT_FRAGMENT_NODE) {
    var newFirst = newChild.firstChild;
    if (newFirst == null) {
      return newChild;
    }
    var newLast = newChild.lastChild;
  } else {
    newFirst = newLast = newChild;
  }
  var pre = nextChild ? nextChild.previousSibling : parentNode.lastChild;

  newFirst.previousSibling = pre;
  newLast.nextSibling = nextChild;

  if (pre) {
    pre.nextSibling = newFirst;
  } else {
    parentNode.firstChild = newFirst;
  }
  if (nextChild == null) {
    parentNode.lastChild = newLast;
  } else {
    nextChild.previousSibling = newLast;
  }
  do {
    newFirst.parentNode = parentNode;
  } while (newFirst !== newLast && (newFirst = newFirst.nextSibling));
  _onUpdateChild(parentNode.ownerDocument || parentNode, parentNode);
  //console.log(parentNode.lastChild.nextSibling == null)
  if (newChild.nodeType == DOCUMENT_FRAGMENT_NODE) {
    newChild.firstChild = newChild.lastChild = null;
  }
  return newChild;
}
function _appendSingleChild(parentNode, newChild) {
  var cp = newChild.parentNode;
  if (cp) {
    var pre = parentNode.lastChild;
    cp.removeChild(newChild); //remove and update
    var pre = parentNode.lastChild;
  }
  var pre = parentNode.lastChild;
  newChild.parentNode = parentNode;
  newChild.previousSibling = pre;
  newChild.nextSibling = null;
  if (pre) {
    pre.nextSibling = newChild;
  } else {
    parentNode.firstChild = newChild;
  }
  parentNode.lastChild = newChild;
  _onUpdateChild(parentNode.ownerDocument, parentNode, newChild);
  return newChild;
  //console.log("__aa",parentNode.lastChild.nextSibling == null)
}
Document.prototype = {
  //implementation : null,
  nodeName: '#document',
  nodeType: DOCUMENT_NODE,
  doctype: null,
  documentElement: null,
  _inc: 1,

  insertBefore: function insertBefore(newChild, refChild) {
    var this$1 = this;
    //raises 
    if (newChild.nodeType == DOCUMENT_FRAGMENT_NODE) {
      var child = newChild.firstChild;
      while (child) {
        var next = child.nextSibling;
        this$1.insertBefore(child, refChild);
        child = next;
      }
      return newChild;
    }
    if (this.documentElement == null && newChild.nodeType == ELEMENT_NODE) {
      this.documentElement = newChild;
    }

    return _insertBefore(this, newChild, refChild), newChild.ownerDocument = this, newChild;
  },
  removeChild: function removeChild(oldChild) {
    if (this.documentElement == oldChild) {
      this.documentElement = null;
    }
    return _removeChild(this, oldChild);
  },
  // Introduced in DOM Level 2:
  importNode: function importNode(importedNode, deep) {
    return _importNode(this, importedNode, deep);
  },
  // Introduced in DOM Level 2:
  getElementById: function getElementById(id) {
    var rtv = null;
    _visitNode(this.documentElement, function (node) {
      if (node.nodeType == ELEMENT_NODE) {
        if (node.getAttribute('id') == id) {
          rtv = node;
          return true;
        }
      }
    });
    return rtv;
  },

  //document factory method:
  createElement: function createElement(tagName) {
    var node = new Element();
    node.ownerDocument = this;
    node.nodeName = tagName;
    node.tagName = tagName;
    node.childNodes = new NodeList();
    var attrs = node.attributes = new NamedNodeMap();
    attrs._ownerElement = node;
    return node;
  },
  createDocumentFragment: function createDocumentFragment() {
    var node = new DocumentFragment();
    node.ownerDocument = this;
    node.childNodes = new NodeList();
    return node;
  },
  createTextNode: function createTextNode(data) {
    var node = new Text();
    node.ownerDocument = this;
    node.appendData(data);
    return node;
  },
  createComment: function createComment(data) {
    var node = new Comment();
    node.ownerDocument = this;
    node.appendData(data);
    return node;
  },
  createCDATASection: function createCDATASection(data) {
    var node = new CDATASection();
    node.ownerDocument = this;
    node.appendData(data);
    return node;
  },
  createProcessingInstruction: function createProcessingInstruction(target, data) {
    var node = new ProcessingInstruction();
    node.ownerDocument = this;
    node.tagName = node.target = target;
    node.nodeValue = node.data = data;
    return node;
  },
  createAttribute: function createAttribute(name) {
    var node = new Attr();
    node.ownerDocument = this;
    node.name = name;
    node.nodeName = name;
    node.localName = name;
    node.specified = true;
    return node;
  },
  createEntityReference: function createEntityReference(name) {
    var node = new EntityReference();
    node.ownerDocument = this;
    node.nodeName = name;
    return node;
  },
  // Introduced in DOM Level 2:
  createElementNS: function createElementNS(namespaceURI, qualifiedName) {
    var node = new Element();
    var pl = qualifiedName.split(':');
    var attrs = node.attributes = new NamedNodeMap();
    node.childNodes = new NodeList();
    node.ownerDocument = this;
    node.nodeName = qualifiedName;
    node.tagName = qualifiedName;
    node.namespaceURI = namespaceURI;
    if (pl.length == 2) {
      node.prefix = pl[0];
      node.localName = pl[1];
    } else {
      //el.prefix = null;
      node.localName = qualifiedName;
    }
    attrs._ownerElement = node;
    return node;
  },
  // Introduced in DOM Level 2:
  createAttributeNS: function createAttributeNS(namespaceURI, qualifiedName) {
    var node = new Attr();
    var pl = qualifiedName.split(':');
    node.ownerDocument = this;
    node.nodeName = qualifiedName;
    node.name = qualifiedName;
    node.namespaceURI = namespaceURI;
    node.specified = true;
    if (pl.length == 2) {
      node.prefix = pl[0];
      node.localName = pl[1];
    } else {
      //el.prefix = null;
      node.localName = qualifiedName;
    }
    return node;
  }
};
_extends(Document, Node);

function Element() {
  this._nsMap = {};
}
Element.prototype = {
  nodeType: ELEMENT_NODE,
  hasAttribute: function hasAttribute(name) {
    return this.getAttributeNode(name) != null;
  },
  getAttribute: function getAttribute(name) {
    var attr = this.getAttributeNode(name);
    return attr && attr.value || '';
  },
  getAttributeNode: function getAttributeNode(name) {
    return this.attributes.getNamedItem(name);
  },
  setAttribute: function setAttribute(name, value) {
    var attr = this.ownerDocument.createAttribute(name);
    attr.value = attr.nodeValue = "" + value;
    this.setAttributeNode(attr);
  },
  removeAttribute: function removeAttribute(name) {
    var attr = this.getAttributeNode(name);
    attr && this.removeAttributeNode(attr);
  },

  //four real opeartion method
  appendChild: function appendChild(newChild) {
    if (newChild.nodeType === DOCUMENT_FRAGMENT_NODE) {
      return this.insertBefore(newChild, null);
    } else {
      return _appendSingleChild(this, newChild);
    }
  },
  setAttributeNode: function setAttributeNode(newAttr) {
    return this.attributes.setNamedItem(newAttr);
  },
  setAttributeNodeNS: function setAttributeNodeNS(newAttr) {
    return this.attributes.setNamedItemNS(newAttr);
  },
  removeAttributeNode: function removeAttributeNode(oldAttr) {
    //console.log(this == oldAttr.ownerElement)
    return this.attributes.removeNamedItem(oldAttr.nodeName);
  },
  //get real attribute name,and remove it by removeAttributeNode
  removeAttributeNS: function removeAttributeNS(namespaceURI, localName) {
    var old = this.getAttributeNodeNS(namespaceURI, localName);
    old && this.removeAttributeNode(old);
  },

  hasAttributeNS: function hasAttributeNS(namespaceURI, localName) {
    return this.getAttributeNodeNS(namespaceURI, localName) != null;
  },
  getAttributeNS: function getAttributeNS(namespaceURI, localName) {
    var attr = this.getAttributeNodeNS(namespaceURI, localName);
    return attr && attr.value || '';
  },
  setAttributeNS: function setAttributeNS(namespaceURI, qualifiedName, value) {
    var attr = this.ownerDocument.createAttributeNS(namespaceURI, qualifiedName);
    attr.value = attr.nodeValue = "" + value;
    this.setAttributeNode(attr);
  },
  getAttributeNodeNS: function getAttributeNodeNS(namespaceURI, localName) {
    return this.attributes.getNamedItemNS(namespaceURI, localName);
  },

  getElementsByTagName: function getElementsByTagName(tagName) {
    return new LiveNodeList(this, function (base) {
      var ls = [];
      _visitNode(base, function (node) {
        if (node !== base && node.nodeType == ELEMENT_NODE && (tagName === '*' || node.tagName == tagName)) {
          ls.push(node);
        }
      });
      return ls;
    });
  },
  getElementsByTagNameNS: function getElementsByTagNameNS(namespaceURI, localName) {
    return new LiveNodeList(this, function (base) {
      var ls = [];
      _visitNode(base, function (node) {
        if (node !== base && node.nodeType === ELEMENT_NODE && (namespaceURI === '*' || node.namespaceURI === namespaceURI) && (localName === '*' || node.localName == localName)) {
          ls.push(node);
        }
      });
      return ls;
    });
  }
};
Document.prototype.getElementsByTagName = Element.prototype.getElementsByTagName;
Document.prototype.getElementsByTagNameNS = Element.prototype.getElementsByTagNameNS;

_extends(Element, Node);
function Attr() {}
Attr.prototype.nodeType = ATTRIBUTE_NODE;
_extends(Attr, Node);

function CharacterData() {}
CharacterData.prototype = {
  data: '',
  substringData: function substringData(offset, count) {
    return this.data.substring(offset, offset + count);
  },
  appendData: function appendData(text) {
    text = this.data + text;
    this.nodeValue = this.data = text;
    this.length = text.length;
  },
  insertData: function insertData(offset, text) {
    this.replaceData(offset, 0, text);
  },
  appendChild: function appendChild(newChild) {
    throw new Error(ExceptionMessage[HIERARCHY_REQUEST_ERR]);
  },
  deleteData: function deleteData(offset, count) {
    this.replaceData(offset, count, "");
  },
  replaceData: function replaceData(offset, count, text) {
    var start = this.data.substring(0, offset);
    var end = this.data.substring(offset + count);
    text = start + text + end;
    this.nodeValue = this.data = text;
    this.length = text.length;
  }
};
_extends(CharacterData, Node);
function Text() {}
Text.prototype = {
  nodeName: "#text",
  nodeType: TEXT_NODE,
  splitText: function splitText(offset) {
    var text = this.data;
    var newText = text.substring(offset);
    text = text.substring(0, offset);
    this.data = this.nodeValue = text;
    this.length = text.length;
    var newNode = this.ownerDocument.createTextNode(newText);
    if (this.parentNode) {
      this.parentNode.insertBefore(newNode, this.nextSibling);
    }
    return newNode;
  }
};
_extends(Text, CharacterData);
function Comment() {}
Comment.prototype = {
  nodeName: "#comment",
  nodeType: COMMENT_NODE
};
_extends(Comment, CharacterData);

function CDATASection() {}
CDATASection.prototype = {
  nodeName: "#cdata-section",
  nodeType: CDATA_SECTION_NODE
};
_extends(CDATASection, CharacterData);

function DocumentType() {}
DocumentType.prototype.nodeType = DOCUMENT_TYPE_NODE;
_extends(DocumentType, Node);

function Notation() {}
Notation.prototype.nodeType = NOTATION_NODE;
_extends(Notation, Node);

function Entity() {}
Entity.prototype.nodeType = ENTITY_NODE;
_extends(Entity, Node);

function EntityReference() {}
EntityReference.prototype.nodeType = ENTITY_REFERENCE_NODE;
_extends(EntityReference, Node);

function DocumentFragment() {}
DocumentFragment.prototype.nodeName = "#document-fragment";
DocumentFragment.prototype.nodeType = DOCUMENT_FRAGMENT_NODE;
_extends(DocumentFragment, Node);

function ProcessingInstruction() {}
ProcessingInstruction.prototype.nodeType = PROCESSING_INSTRUCTION_NODE;
_extends(ProcessingInstruction, Node);
function XMLSerializer$1() {}
XMLSerializer$1.prototype.serializeToString = function (node, isHtml, nodeFilter) {
  return nodeSerializeToString.call(node, isHtml, nodeFilter);
};
Node.prototype.toString = nodeSerializeToString;
function nodeSerializeToString(isHtml, nodeFilter) {
  var buf = [];
  var refNode = this.nodeType == 9 ? this.documentElement : this;
  var prefix = refNode.prefix;
  var uri = refNode.namespaceURI;

  if (uri && prefix == null) {
    //console.log(prefix)
    var prefix = refNode.lookupPrefix(uri);
    if (prefix == null) {
      //isHTML = true;
      var visibleNamespaces = [{ namespace: uri, prefix: null }];
    }
  }
  serializeToString(this, buf, isHtml, nodeFilter, visibleNamespaces);
  //console.log('###',this.nodeType,uri,prefix,buf.join(''))
  return buf.join('');
}
function needNamespaceDefine(node, isHTML, visibleNamespaces) {
  var prefix = node.prefix || '';
  var uri = node.namespaceURI;
  if (!prefix && !uri) {
    return false;
  }
  if (prefix === "xml" && uri === "http://www.w3.org/XML/1998/namespace" || uri == 'http://www.w3.org/2000/xmlns/') {
    return false;
  }

  var i = visibleNamespaces.length;
  //console.log('@@@@',node.tagName,prefix,uri,visibleNamespaces)
  while (i--) {
    var ns = visibleNamespaces[i];
    // get namespace prefix
    //console.log(node.nodeType,node.tagName,ns.prefix,prefix)
    if (ns.prefix == prefix) {
      return ns.namespace != uri;
    }
  }
  //console.log(isHTML,uri,prefix=='')
  //if(isHTML && prefix ==null && uri == 'http://www.w3.org/1999/xhtml'){
  //	return false;
  //}
  //node.flag = '11111'
  //console.error(3,true,node.flag,node.prefix,node.namespaceURI)
  return true;
}
function serializeToString(node, buf, isHTML, nodeFilter, visibleNamespaces) {
  if (nodeFilter) {
    node = nodeFilter(node);
    if (node) {
      if (typeof node == 'string') {
        buf.push(node);
        return;
      }
    } else {
      return;
    }
    //buf.sort.apply(attrs, attributeSorter);
  }
  switch (node.nodeType) {
    case ELEMENT_NODE:
      if (!visibleNamespaces) {
        visibleNamespaces = [];
      }
      var startVisibleNamespaces = visibleNamespaces.length;
      var attrs = node.attributes;
      var len = attrs.length;
      var child = node.firstChild;
      var nodeName = node.tagName;

      isHTML = htmlns === node.namespaceURI || isHTML;
      buf.push('<', nodeName);

      for (var i = 0; i < len; i++) {
        // add namespaces for attributes
        var attr = attrs.item(i);
        if (attr.prefix == 'xmlns') {
          visibleNamespaces.push({ prefix: attr.localName, namespace: attr.value });
        } else if (attr.nodeName == 'xmlns') {
          visibleNamespaces.push({ prefix: '', namespace: attr.value });
        }
      }
      for (var i = 0; i < len; i++) {
        var attr = attrs.item(i);
        if (needNamespaceDefine(attr, isHTML, visibleNamespaces)) {
          var prefix = attr.prefix || '';
          var uri = attr.namespaceURI;
          var ns = prefix ? ' xmlns:' + prefix : " xmlns";
          buf.push(ns, '="', uri, '"');
          visibleNamespaces.push({ prefix: prefix, namespace: uri });
        }
        serializeToString(attr, buf, isHTML, nodeFilter, visibleNamespaces);
      }
      // add namespace for current node		
      if (needNamespaceDefine(node, isHTML, visibleNamespaces)) {
        var prefix = node.prefix || '';
        var uri = node.namespaceURI;
        var ns = prefix ? ' xmlns:' + prefix : " xmlns";
        buf.push(ns, '="', uri, '"');
        visibleNamespaces.push({ prefix: prefix, namespace: uri });
      }

      if (child || isHTML && !/^(?:meta|link|img|br|hr|input)$/i.test(nodeName)) {
        buf.push('>');
        //if is cdata child node
        if (isHTML && /^script$/i.test(nodeName)) {
          while (child) {
            if (child.data) {
              buf.push(child.data);
            } else {
              serializeToString(child, buf, isHTML, nodeFilter, visibleNamespaces);
            }
            child = child.nextSibling;
          }
        } else {
          while (child) {
            serializeToString(child, buf, isHTML, nodeFilter, visibleNamespaces);
            child = child.nextSibling;
          }
        }
        buf.push('</', nodeName, '>');
      } else {
        buf.push('/>');
      }
      // remove added visible namespaces
      //visibleNamespaces.length = startVisibleNamespaces;
      return;
    case DOCUMENT_NODE:
    case DOCUMENT_FRAGMENT_NODE:
      var child = node.firstChild;
      while (child) {
        serializeToString(child, buf, isHTML, nodeFilter, visibleNamespaces);
        child = child.nextSibling;
      }
      return;
    case ATTRIBUTE_NODE:
      return buf.push(' ', node.name, '="', node.value.replace(/[<&"]/g, _xmlEncoder), '"');
    case TEXT_NODE:
      return buf.push(node.data.replace(/[<&]/g, _xmlEncoder));
    case CDATA_SECTION_NODE:
      return buf.push('<![CDATA[', node.data, ']]>');
    case COMMENT_NODE:
      return buf.push("<!--", node.data, "-->");
    case DOCUMENT_TYPE_NODE:
      var pubid = node.publicId;
      var sysid = node.systemId;
      buf.push('<!DOCTYPE ', node.name);
      if (pubid) {
        buf.push(' PUBLIC "', pubid);
        if (sysid && sysid != '.') {
          buf.push('" "', sysid);
        }
        buf.push('">');
      } else if (sysid && sysid != '.') {
        buf.push(' SYSTEM "', sysid, '">');
      } else {
        var sub = node.internalSubset;
        if (sub) {
          buf.push(" [", sub, "]");
        }
        buf.push(">");
      }
      return;
    case PROCESSING_INSTRUCTION_NODE:
      return buf.push("<?", node.target, " ", node.data, "?>");
    case ENTITY_REFERENCE_NODE:
      return buf.push('&', node.nodeName, ';');
    //case ENTITY_NODE:
    //case NOTATION_NODE:
    default:
      buf.push('??', node.nodeName);
  }
}
function _importNode(doc, node, deep) {
  var node2;
  switch (node.nodeType) {
    case ELEMENT_NODE:
      node2 = node.cloneNode(false);
      node2.ownerDocument = doc;
    //var attrs = node2.attributes;
    //var len = attrs.length;
    //for(var i=0;i<len;i++){
    //node2.setAttributeNodeNS(importNode(doc,attrs.item(i),deep));
    //}
    case DOCUMENT_FRAGMENT_NODE:
      break;
    case ATTRIBUTE_NODE:
      deep = true;
      break;
    //case ENTITY_REFERENCE_NODE:
    //case PROCESSING_INSTRUCTION_NODE:
    ////case TEXT_NODE:
    //case CDATA_SECTION_NODE:
    //case COMMENT_NODE:
    //	deep = false;
    //	break;
    //case DOCUMENT_NODE:
    //case DOCUMENT_TYPE_NODE:
    //cannot be imported.
    //case ENTITY_NODE:
    //case NOTATION_NODE：
    //can not hit in level3
    //default:throw e;
  }
  if (!node2) {
    node2 = node.cloneNode(false); //false
  }
  node2.ownerDocument = doc;
  node2.parentNode = null;
  if (deep) {
    var child = node.firstChild;
    while (child) {
      node2.appendChild(_importNode(doc, child, deep));
      child = child.nextSibling;
    }
  }
  return node2;
}
//
//var _relationMap = {firstChild:1,lastChild:1,previousSibling:1,nextSibling:1,
//					attributes:1,childNodes:1,parentNode:1,documentElement:1,doctype,};
function _cloneNode(doc, node, deep) {
  var node2 = new node.constructor();
  for (var n in node) {
    var v = node[n];
    if ((typeof v === 'undefined' ? 'undefined' : _typeof(v)) != 'object') {
      if (v != node2[n]) {
        node2[n] = v;
      }
    }
  }
  if (node.childNodes) {
    node2.childNodes = new NodeList();
  }
  node2.ownerDocument = doc;
  switch (node2.nodeType) {
    case ELEMENT_NODE:
      var attrs = node.attributes;
      var attrs2 = node2.attributes = new NamedNodeMap();
      var len = attrs.length;
      attrs2._ownerElement = node2;
      for (var i = 0; i < len; i++) {
        node2.setAttributeNode(_cloneNode(doc, attrs.item(i), true));
      }
      break;;
    case ATTRIBUTE_NODE:
      deep = true;
  }
  if (deep) {
    var child = node.firstChild;
    while (child) {
      node2.appendChild(_cloneNode(doc, child, deep));
      child = child.nextSibling;
    }
  }
  return node2;
}

function __set__(object, key, value) {
  object[key] = value;
}
//do dynamic
try {
  if (Object.defineProperty) {
    var getTextContent = function getTextContent(node) {
      switch (node.nodeType) {
        case ELEMENT_NODE:
        case DOCUMENT_FRAGMENT_NODE:
          var buf = [];
          node = node.firstChild;
          while (node) {
            if (node.nodeType !== 7 && node.nodeType !== 8) {
              buf.push(getTextContent(node));
            }
            node = node.nextSibling;
          }
          return buf.join('');
        default:
          return node.nodeValue;
      }
    };

    Object.defineProperty(LiveNodeList.prototype, 'length', {
      get: function get() {
        _updateLiveList(this);
        return this.$$length;
      }
    });
    Object.defineProperty(Node.prototype, 'textContent', {
      get: function get() {
        return getTextContent(this);
      },
      set: function set(data) {
        var this$1 = this;

        switch (this.nodeType) {
          case ELEMENT_NODE:
          case DOCUMENT_FRAGMENT_NODE:
            while (this.firstChild) {
              this$1.removeChild(this$1.firstChild);
            }
            if (data || String(data)) {
              this.appendChild(this.ownerDocument.createTextNode(data));
            }
            break;
          default:
            //TODO:
            this.data = data;
            this.value = data;
            this.nodeValue = data;
        }
      }
    });

    __set__ = function __set__(object, key, value) {
      //console.log(value)
      object['$$' + key] = value;
    };
  }
} catch (e) {} //ie8


//if(typeof require == 'function'){
var DOMImplementation_1 = DOMImplementation;
var XMLSerializer_1 = XMLSerializer$1;
//}

var dom = {
  DOMImplementation: DOMImplementation_1,
  XMLSerializer: XMLSerializer_1
};

var domParser = createCommonjsModule(function (module, exports) {
  function DOMParser(options) {
    this.options = options || { locator: {} };
  }
  DOMParser.prototype.parseFromString = function (source, mimeType) {
    var options = this.options;
    var sax$$1 = new XMLReader();
    var domBuilder = options.domBuilder || new DOMHandler(); //contentHandler and LexicalHandler
    var errorHandler = options.errorHandler;
    var locator = options.locator;
    var defaultNSMap = options.xmlns || {};
    var entityMap = { 'lt': '<', 'gt': '>', 'amp': '&', 'quot': '"', 'apos': "'" };
    if (locator) {
      domBuilder.setDocumentLocator(locator);
    }

    sax$$1.errorHandler = buildErrorHandler(errorHandler, domBuilder, locator);
    sax$$1.domBuilder = options.domBuilder || domBuilder;
    if (/\/x?html?$/.test(mimeType)) {
      entityMap.nbsp = '\xa0';
      entityMap.copy = '\xa9';
      defaultNSMap[''] = 'http://www.w3.org/1999/xhtml';
    }
    defaultNSMap.xml = defaultNSMap.xml || 'http://www.w3.org/XML/1998/namespace';
    if (source) {
      sax$$1.parse(source, defaultNSMap, entityMap);
    } else {
      sax$$1.errorHandler.error("invalid doc source");
    }
    return domBuilder.doc;
  };
  function buildErrorHandler(errorImpl, domBuilder, locator) {
    if (!errorImpl) {
      if (domBuilder instanceof DOMHandler) {
        return domBuilder;
      }
      errorImpl = domBuilder;
    }
    var errorHandler = {};
    var isCallback = errorImpl instanceof Function;
    locator = locator || {};
    function build(key) {
      var fn = errorImpl[key];
      if (!fn && isCallback) {
        fn = errorImpl.length == 2 ? function (msg) {
          errorImpl(key, msg);
        } : errorImpl;
      }
      errorHandler[key] = fn && function (msg) {
        fn('[xmldom ' + key + ']\t' + msg + _locator(locator));
      } || function () {};
    }
    build('warning');
    build('error');
    build('fatalError');
    return errorHandler;
  }

  //console.log('#\n\n\n\n\n\n\n####')
  /**
   * +ContentHandler+ErrorHandler
   * +LexicalHandler+EntityResolver2
   * -DeclHandler-DTDHandler 
   * 
   * DefaultHandler:EntityResolver, DTDHandler, ContentHandler, ErrorHandler
   * DefaultHandler2:DefaultHandler,LexicalHandler, DeclHandler, EntityResolver2
   * @link http://www.saxproject.org/apidoc/org/xml/sax/helpers/DefaultHandler.html
   */
  function DOMHandler() {
    this.cdata = false;
  }
  function position(locator, node) {
    node.lineNumber = locator.lineNumber;
    node.columnNumber = locator.columnNumber;
  }
  /**
   * @see org.xml.sax.ContentHandler#startDocument
   * @link http://www.saxproject.org/apidoc/org/xml/sax/ContentHandler.html
   */
  DOMHandler.prototype = {
    startDocument: function startDocument() {
      this.doc = new DOMImplementation().createDocument(null, null, null);
      if (this.locator) {
        this.doc.documentURI = this.locator.systemId;
      }
    },
    startElement: function startElement(namespaceURI, localName, qName, attrs) {
      var this$1 = this;

      var doc = this.doc;
      var el = doc.createElementNS(namespaceURI, qName || localName);
      var len = attrs.length;
      appendElement(this, el);
      this.currentElement = el;

      this.locator && position(this.locator, el);
      for (var i = 0; i < len; i++) {
        var namespaceURI = attrs.getURI(i);
        var value = attrs.getValue(i);
        var qName = attrs.getQName(i);
        var attr = doc.createAttributeNS(namespaceURI, qName);
        this$1.locator && position(attrs.getLocator(i), attr);
        attr.value = attr.nodeValue = value;
        el.setAttributeNode(attr);
      }
    },
    endElement: function endElement(namespaceURI, localName, qName) {
      var current = this.currentElement;
      var tagName = current.tagName;
      this.currentElement = current.parentNode;
    },
    startPrefixMapping: function startPrefixMapping(prefix, uri) {},
    endPrefixMapping: function endPrefixMapping(prefix) {},
    processingInstruction: function processingInstruction(target, data) {
      var ins = this.doc.createProcessingInstruction(target, data);
      this.locator && position(this.locator, ins);
      appendElement(this, ins);
    },
    ignorableWhitespace: function ignorableWhitespace(ch, start, length) {},
    characters: function characters(chars, start, length) {
      chars = _toString.apply(this, arguments);
      //console.log(chars)
      if (chars) {
        if (this.cdata) {
          var charNode = this.doc.createCDATASection(chars);
        } else {
          var charNode = this.doc.createTextNode(chars);
        }
        if (this.currentElement) {
          this.currentElement.appendChild(charNode);
        } else if (/^\s*$/.test(chars)) {
          this.doc.appendChild(charNode);
          //process xml
        }
        this.locator && position(this.locator, charNode);
      }
    },
    skippedEntity: function skippedEntity(name) {},
    endDocument: function endDocument() {
      this.doc.normalize();
    },
    setDocumentLocator: function setDocumentLocator(locator) {
      if (this.locator = locator) {
        // && !('lineNumber' in locator)){
        locator.lineNumber = 0;
      }
    },
    //LexicalHandler
    comment: function comment(chars, start, length) {
      chars = _toString.apply(this, arguments);
      var comm = this.doc.createComment(chars);
      this.locator && position(this.locator, comm);
      appendElement(this, comm);
    },

    startCDATA: function startCDATA() {
      //used in characters() methods
      this.cdata = true;
    },
    endCDATA: function endCDATA() {
      this.cdata = false;
    },

    startDTD: function startDTD(name, publicId, systemId) {
      var impl = this.doc.implementation;
      if (impl && impl.createDocumentType) {
        var dt = impl.createDocumentType(name, publicId, systemId);
        this.locator && position(this.locator, dt);
        appendElement(this, dt);
      }
    },
    /**
     * @see org.xml.sax.ErrorHandler
     * @link http://www.saxproject.org/apidoc/org/xml/sax/ErrorHandler.html
     */
    warning: function warning(error) {
      console.warn('[xmldom warning]\t' + error, _locator(this.locator));
    },
    error: function error(_error) {
      console.error('[xmldom error]\t' + _error, _locator(this.locator));
    },
    fatalError: function fatalError(error) {
      console.error('[xmldom fatalError]\t' + error, _locator(this.locator));
      throw error;
    }
  };
  function _locator(l) {
    if (l) {
      return '\n@' + (l.systemId || '') + '#[line:' + l.lineNumber + ',col:' + l.columnNumber + ']';
    }
  }
  function _toString(chars, start, length) {
    if (typeof chars == 'string') {
      return chars.substr(start, length);
    } else {
      //java sax connect width xmldom on rhino(what about: "? && !(chars instanceof String)")
      if (chars.length >= start + length || start) {
        return new java.lang.String(chars, start, length) + '';
      }
      return chars;
    }
  }

  /*
   * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/LexicalHandler.html
   * used method of org.xml.sax.ext.LexicalHandler:
   *  #comment(chars, start, length)
   *  #startCDATA()
   *  #endCDATA()
   *  #startDTD(name, publicId, systemId)
   *
   *
   * IGNORED method of org.xml.sax.ext.LexicalHandler:
   *  #endDTD()
   *  #startEntity(name)
   *  #endEntity(name)
   *
   *
   * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/DeclHandler.html
   * IGNORED method of org.xml.sax.ext.DeclHandler
   * 	#attributeDecl(eName, aName, type, mode, value)
   *  #elementDecl(name, model)
   *  #externalEntityDecl(name, publicId, systemId)
   *  #internalEntityDecl(name, value)
   * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/EntityResolver2.html
   * IGNORED method of org.xml.sax.EntityResolver2
   *  #resolveEntity(String name,String publicId,String baseURI,String systemId)
   *  #resolveEntity(publicId, systemId)
   *  #getExternalSubset(name, baseURI)
   * @link http://www.saxproject.org/apidoc/org/xml/sax/DTDHandler.html
   * IGNORED method of org.xml.sax.DTDHandler
   *  #notationDecl(name, publicId, systemId) {};
   *  #unparsedEntityDecl(name, publicId, systemId, notationName) {};
   */
  "endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(/\w+/g, function (key) {
    DOMHandler.prototype[key] = function () {
      return null;
    };
  });

  /* Private static helpers treated below as private instance methods, so don't need to add these to the public API; we might use a Relator to also get rid of non-standard public properties */
  function appendElement(hander, node) {
    if (!hander.currentElement) {
      hander.doc.appendChild(node);
    } else {
      hander.currentElement.appendChild(node);
    }
  } //appendChild and setAttributeNS are preformance key

  //if(typeof require == 'function'){
  var XMLReader = sax.XMLReader;
  var DOMImplementation = exports.DOMImplementation = dom.DOMImplementation;
  exports.XMLSerializer = dom.XMLSerializer;
  exports.DOMParser = DOMParser;
  //}
});

var Blob$8 = makeBlob();

var XMLSerializer$$1 = domParser.XMLSerializer;
// NOTE: might be useful :https://github.com/jindw/xmldom/pull/152/commits/be5176ece6fa1591daef96a5f361aaacaa445175

function CSGToX3D(CSG) {
  var DOMImplementation$$1 = typeof document !== 'undefined' ? document.implementation : new domParser.DOMImplementation();
  // materialPolygonLists
  // key: a color string (e.g. "0 1 1" for yellow)
  // value: an array of strings specifying polygons of this color
  //        (as space-separated indices into vertexCoords)
  var materialPolygonLists = {},

  // list of coordinates (as "x y z" strings)
  vertexCoords = [],

  // map to look up the index in vertexCoords of a given vertex
  vertexTagToCoordIndexMap = {};

  CSG.polygons.map(function (p) {
    var red = 0,
        green = 0,
        blue = 1; // default color is blue
    if (p.shared && p.shared.color) {
      red = p.shared.color[0];
      green = p.shared.color[1];
      blue = p.shared.color[2];
    }

    var polygonVertexIndices = [],
        numvertices = p.vertices.length,
        vertex;
    for (var i = 0; i < numvertices; i++) {
      vertex = p.vertices[i];
      if (!(vertex.getTag() in vertexTagToCoordIndexMap)) {
        vertexCoords.push(vertex.pos._x.toString() + ' ' + vertex.pos._y.toString() + ' ' + vertex.pos._z.toString());
        vertexTagToCoordIndexMap[vertex.getTag()] = vertexCoords.length - 1;
      }
      polygonVertexIndices.push(vertexTagToCoordIndexMap[vertex.getTag()]);
    }

    var polygonString = polygonVertexIndices.join(' ');

    var colorString = red.toString() + ' ' + green.toString() + ' ' + blue.toString();
    if (!(colorString in materialPolygonLists)) {
      materialPolygonLists[colorString] = [];
    }
    // add this polygonString to the list of colorString-colored polygons
    materialPolygonLists[colorString].push(polygonString);
  });

  // create output document
  var docType = DOMImplementation$$1.createDocumentType('X3D', 'ISO//Web3D//DTD X3D 3.1//EN', 'http://www.web3d.org/specifications/x3d-3.1.dtd');
  var exportDoc = DOMImplementation$$1.createDocument(null, 'X3D', docType);
  exportDoc.insertBefore(exportDoc.createProcessingInstruction('xml', 'version="1.0" encoding="UTF-8"'), exportDoc.doctype);

  var exportRoot = exportDoc.getElementsByTagName('X3D')[0];
  exportRoot.setAttribute('profile', 'Interchange');
  exportRoot.setAttribute('version', '3.1');
  exportRoot.setAttribute('xsd:noNamespaceSchemaLocation', 'http://www.web3d.org/specifications/x3d-3.1.xsd');
  exportRoot.setAttribute('xmlns:xsd', 'http://www.w3.org/2001/XMLSchema-instance');

  var exportScene = exportDoc.createElement('Scene');
  exportRoot.appendChild(exportScene);

  /*
      For each color, create a shape made of an appropriately colored
      material which contains all polygons that are this color.
       The first shape will contain the definition of all vertices,
      (<Coordinate DEF="coords_mesh"/>), which will be referenced by
      subsequent shapes.
    */
  var coordsMeshDefined = false;
  for (var colorString in materialPolygonLists) {
    var polygonList = materialPolygonLists[colorString];
    var shape = exportDoc.createElement('Shape');
    exportScene.appendChild(shape);

    var appearance = exportDoc.createElement('Appearance');
    shape.appendChild(appearance);

    var material = exportDoc.createElement('Material');
    appearance.appendChild(material);
    material.setAttribute('diffuseColor', colorString);
    material.setAttribute('ambientIntensity', '1.0');

    var ifs = exportDoc.createElement('IndexedFaceSet');
    shape.appendChild(ifs);
    ifs.setAttribute('solid', 'true');
    ifs.setAttribute('coordIndex', polygonList.join(' -1 ') + ' -1');

    var coordinate = exportDoc.createElement('Coordinate');
    ifs.appendChild(coordinate);
    if (coordsMeshDefined) {
      coordinate.setAttribute('USE', 'coords_mesh');
    } else {
      coordinate.setAttribute('DEF', 'coords_mesh');
      coordinate.setAttribute('point', vertexCoords.join(' '));
      coordsMeshDefined = true;
    }
  }

  var x3dstring = new XMLSerializer$$1().serializeToString(exportDoc);
  return new Blob$8([x3dstring], {
    type: 'model/x3d+xml'
  });
}

/*
## License

Copyright (c) 2016 Z3 Development https://github.com/z3dev
Copyright (c) 2013-2016 by Rene K. Mueller <spiritdude@gmail.com>
Copyright (c) 2016 by Z3D Development

All code released under MIT license

History:
  2016/06/27: 0.5.1: rewrote using SAX XML parser, enhanced for multiple objects, materials, units by Z3Dev
  2013/04/11: 0.018: added alpha support to AMF export

*/

// //////////////////////////////////////////
//
// AMF is a language for describing three-dimensional graphics in XML
// See http://www.astm.org/Standards/ISOASTM52915.htm
// See http://amf.wikispaces.com/
//
// //////////////////////////////////////////
var sax$2 = require('sax');

var inchMM = 1 / 0.039370; // used for scaling AMF (inch) to CAG coordinates(MM)

// processing controls
sax$2.SAXParser.prototype.amfLast = null; // last object found
sax$2.SAXParser.prototype.amfDefinition = 0; // definitions beinging created
//   0-AMF,1-object,2-material,3-texture,4-constellation,5-metadata
// high level elements / definitions
sax$2.SAXParser.prototype.amfObjects = []; // list of objects
sax$2.SAXParser.prototype.amfMaterials = []; // list of materials
sax$2.SAXParser.prototype.amfTextures = []; // list of textures
sax$2.SAXParser.prototype.amfConstels = []; // list of constellations
sax$2.SAXParser.prototype.amfMetadata = []; // list of metadata

sax$2.SAXParser.prototype.amfObj = null; // amf in object form

function amfAmf(element) {
  // default SVG with no viewport
  var obj = { type: 'amf', unit: 'mm', scale: 1.0 };

  if ('UNIT' in element) {
    obj.unit = element.UNIT.toLowerCase();
  }
  // set scaling
  switch (obj.unit.toLowerCase()) {
    case 'inch':
      obj.scale = inchMM;
      break;
    case 'foot':
      obj.scale = inchMM * 12.0;
      break;
    case 'meter':
      obj.scale = 1000.0;
      break;
    case 'micron':
      obj.scale = 0.001;
      break;
    case 'millimeter':
    default:
      break;
  }

  obj.objects = [];
  return obj;
}

sax$2.SAXParser.prototype.amfObject = function (element) {
  var obj = { type: 'object', id: 'JSCAD' + this.amfObjects.length }; // default ID

  if ('ID' in element) {
    obj.id = element.ID;
  }

  obj.objects = [];
  return obj;
};

function amfMesh(element) {
  var obj = { type: 'mesh' };

  obj.objects = [];
  return obj;
}

// Note: TBD Vertices can have a color, which is used to interpolate a face color (from the 3 vertices)
function amfVertices(element) {
  var obj = { type: 'vertices' };
  obj.objects = [];
  return obj;
}

function amfCoordinates(element) {
  var obj = { type: 'coordinates' };

  obj.objects = [];
  return obj;
}
function amfNormal(element) {
  var obj = { type: 'normal' };

  obj.objects = [];
  return obj;
}
function amfX(element) {
  return { type: 'x', value: '0' };
}
function amfY(element) {
  return { type: 'y', value: '0' };
}
function amfZ(element) {
  return { type: 'z', value: '0' };
}

function amfVolume(element) {
  var obj = { type: 'volume' };

  if ('MATERIALID' in element) {
    obj.materialid = element.MATERIALID;
  }

  obj.objects = [];
  return obj;
}

function amfTriangle(element) {
  var obj = { type: 'triangle' };

  obj.objects = [];
  return obj;
}
function amfV1(element) {
  return { type: 'v1', value: '0' };
}
function amfV2(element) {
  return { type: 'v2', value: '0' };
}
function amfV3(element) {
  return { type: 'v3', value: '0' };
}

function amfVertex(element) {
  var obj = { type: 'vertex' };
  obj.objects = [];
  return obj;
}

function amfEdge(element) {
  var obj = { type: 'edge' };

  obj.objects = [];
  return obj;
}

function amfMetadata(element) {
  var obj = { type: 'metadata' };

  if ('TYPE' in element) {
    obj.mtype = element.TYPE;
  }
  if ('ID' in element) {
    obj.id = element.ID;
  }

  return obj;
}

function amfMaterial(element) {
  var obj = { type: 'material' };

  if ('ID' in element) {
    obj.id = element.ID;
  }

  obj.objects = [];
  return obj;
}

function amfColor(element) {
  var obj = { type: 'color' };

  obj.objects = [];
  return obj;
}
function amfR(element) {
  return { type: 'r', value: '1' };
}
function amfG(element) {
  return { type: 'g', value: '1' };
}
function amfB(element) {
  return { type: 'b', value: '1' };
}
function amfA(element) {
  return { type: 'a', value: '1' };
}

function amfMap(element) {
  var obj = { type: 'map' };

  if ('GTEXID' in element) {
    obj.gtexid = element.GTEXID;
  }
  if ('BTEXID' in element) {
    obj.btexid = element.BTEXID;
  }
  if ('RTEXID' in element) {
    obj.rtexid = element.RTEXID;
  }

  obj.objects = [];
  return obj;
}

function amfU1(element) {
  return { type: 'u1', value: '0' };
}
function amfU2(element) {
  return { type: 'u2', value: '0' };
}
function amfU3(element) {
  return { type: 'u3', value: '0' };
}

function createAmfParser(src, pxPmm) {
  // create a parser for the XML
  var parser = sax$2.parser(false, { trim: true, lowercase: false, position: true });

  parser.onerror = function (e) {
    console.log('error: line ' + e.line + ', column ' + e.column + ', bad character [' + e.c + ']');
  };
  parser.onopentag = function (node) {
    // console.log('opentag: '+node.name+' at line '+this.line+' position '+this.column);
    // for (x in node.attributes) {
    //  console.log('    '+x+'='+node.attributes[x]);
    // }
    var obj = null;
    switch (node.name) {
      // top level elements
      case 'AMF':
        obj = amfAmf(node.attributes);
        break;
      case 'OBJECT':
        obj = this.amfObject(node.attributes);
        if (this.amfDefinition === 0) {
          this.amfDefinition = 1;
        } // OBJECT processing
        break;
      case 'MESH':
        obj = amfMesh(node.attributes);
        break;
      case 'VERTICES':
        obj = amfVertices(node.attributes);
        break;
      case 'VERTEX':
        obj = amfVertex(node.attributes);
        break;
      case 'EDGE':
        obj = amfEdge(node.attributes);
        break;
      case 'VOLUME':
        obj = amfVolume(node.attributes);
        break;
      case 'MATERIAL':
        obj = amfMaterial(node.attributes);
        if (this.amfDefinition === 0) {
          this.amfDefinition = 2;
        } // MATERIAL processing
        break;
      case 'COMPOSITE':
        break;
      case 'TEXTURE':
        if (this.amfDefinition === 0) {
          this.amfDefinition = 3;
        } // TEXTURE processing
        break;
      case 'CONSTELLATION':
        if (this.amfDefinition === 0) {
          this.amfDefinition = 4;
        } // CONSTELLATION processing
        break;
      case 'METADATA':
        obj = amfMetadata(node.attributes);
        if (this.amfDefinition === 0) {
          this.amfDefinition = 5;
        } // METADATA processing
        break;
      // coordinate elements
      case 'COORDINATES':
        obj = amfCoordinates(node.attributes);
        break;
      case 'NORMAL':
        obj = amfNormal(node.attributes);
        break;
      case 'X':
      case 'NX':
        obj = amfX(node.attributes);
        break;
      case 'Y':
      case 'NY':
        obj = amfY(node.attributes);
        break;
      case 'Z':
      case 'NZ':
        obj = amfZ(node.attributes);
        break;
      // triangle elements
      case 'TRIANGLE':
        obj = amfTriangle(node.attributes);
        break;
      case 'V1':
      case 'VTEX1':
        obj = amfV1(node.attributes);
        break;
      case 'V2':
      case 'VTEX2':
        obj = amfV2(node.attributes);
        break;
      case 'V3':
      case 'VTEX3':
        obj = amfV3(node.attributes);
        break;
      // color elements
      case 'COLOR':
        obj = amfColor(node.attributes);
        break;
      case 'R':
        obj = amfR(node.attributes);
        break;
      case 'G':
        obj = amfG(node.attributes);
        break;
      case 'B':
        obj = amfB(node.attributes);
        break;
      case 'A':
        obj = amfA(node.attributes);
        break;
      // map elements
      case 'MAP':
      case 'TEXMAP':
        obj = amfMap(node.attributes);
        break;
      case 'U1':
      case 'UTEX1':
      case 'VTEX1':
      case 'WTEX1':
        obj = amfU1(node.attributes);
        break;
      case 'U2':
      case 'UTEX2':
      case 'VTEX2':
      case 'WTEX2':
        obj = amfU2(node.attributes);
        break;
      case 'U3':
      case 'UTEX3':
      case 'VTEX3':
      case 'WTEX3':
        obj = amfU3(node.attributes);
        break;
      default:
        // console.log('opentag: '+node.name+' at line '+this.line+' position '+this.column);
        break;
    }

    if (obj !== null) {
      // console.log('definitinon '+this.amfDefinition);
      switch (this.amfDefinition) {
        case 0:
          // definition of AMF
          if ('objects' in obj) {
            // console.log('push object ['+obj.type+']');
            this.amfObjects.push(obj);
          }
          break;
        case 1:
          // definition of OBJECT
          if (this.amfObjects.length > 0) {
            var group = this.amfObjects.pop();
            // add the object to the active group if necessary
            if ('objects' in group) {
              // console.log('object '+group.type+' adding ['+obj.type+']');
              // console.log(JSON.stringify(obj));
              group.objects.push(obj);
            }
            this.amfObjects.push(group);
            // and push this object as a group object if necessary
            if ('objects' in obj) {
              // console.log('object group ['+obj.type+']');
              this.amfObjects.push(obj);
            }
          }
          break;
        case 2:
          // definition of MATERIAL
          if (obj.type === 'material') {
            // console.log('push material ['+obj.type+']');
            this.amfMaterials.push(obj);
          } else {
            if (this.amfMaterials.length > 0) {
              var group = this.amfMaterials.pop();
              // add the object to the active group if necessary
              if ('objects' in group) {
                // console.log('material '+group.type+' adding ['+obj.type+']');
                // console.log(JSON.stringify(obj));
                group.objects.push(obj);
              }
              this.amfMaterials.push(group);
              // and push this object as a group object if necessary
              if ('objects' in obj) {
                // console.log('push material ['+obj.type+']');
                this.amfMaterials.push(obj);
              }
            }
          }
          break;
        case 3:
          // definition of TEXTURE
          break;
        case 4:
          // definition of CONSTELLATION
          break;
        case 5:
          // definition of METADATA
          break;
        default:
          console.log('ERROR: invalid AMF definition');
          break;
      }
      this.amfLast = obj; // retain this object in order to add values
    }
  };

  parser.onclosetag = function (node) {
    // console.log('onclosetag: '+this.amfDefinition);
    switch (node) {
      // list those which have objects
      case 'AMF':
      case 'OBJECT':
      case 'MESH':
      case 'VERTICES':
      case 'VERTEX':
      case 'EDGE':
      case 'COORDINATES':
      case 'NORMAL':
      case 'VOLUME':
      case 'TRIANGLE':
      case 'MATERIAL':
      case 'COLOR':
      case 'MAP':
      case 'TEXMAP':
        break;
      case 'TEXTURE':
        if (this.amfDefinition === 3) {
          this.amfDefinition = 0;
        } // resume processing
        return;
      case 'CONSTELLATION':
        if (this.amfDefinition === 4) {
          this.amfDefinition = 0;
        } // resume processing
        return;
      case 'METADATA':
        if (this.amfDefinition === 5) {
          this.amfDefinition = 0;
        } // resume processing
        return;
      default:
        // console.log('closetag: '+node);
        return;
    }

    var obj = null;
    switch (this.amfDefinition) {
      case 0: // definition of AMF
      case 1:
        // definition of OBJECT
        if (this.amfObjects.length > 0) {
          obj = this.amfObjects.pop();
          // console.log('pop object ['+obj.type+']');
          if (obj.type === 'object') {
            this.amfDefinition = 0; // AMF processing
          }
        }
        // check for completeness
        if (this.amfObjects.length === 0) {
          this.amfObj = obj;
        }
        break;
      case 2:
        // definition of MATERIAL
        if (this.amfMaterials.length > 0) {
          obj = this.amfMaterials.pop();
          // console.log('pop material ['+obj.type+']');
          if (obj.type === 'material') {
            this.amfMaterials.push(obj); // keep a list of materials
            this.amfDefinition = 0; // AMF processing
          }
        }
        break;
      case 3:
        // definition of TEXTURE
        this.amfDefinition = 0; // AMF processing
        break;
      case 4:
        // definition of CONSTELLATION
        this.amfDefinition = 0; // AMF processing
        break;
      case 5:
        // definition of METADATA
        this.amfDefinition = 0; // AMF processing
        break;
      default:
        break;
    }
  };

  parser.ontext = function (value) {
    if (value !== null) {
      if (this.amfLast && this.amfDefinition !== 0) {
        this.amfLast.value = value;
        // console.log(JSON.stringify(this.amfLast));
      }
    }
  };

  parser.onend = function () {
    // console.log('AMF parsing completed');
  };

  // start the parser
  parser.write(src).close();

  return parser;
}

//
// convert the internal repreentation into JSCAD code
//
function codify(amf, data) {
  if (amf.type !== 'amf' || !amf.objects) {
    throw new Error('AMF malformed');
  }

  var code = '';

  // hack due to lack of this in array map()
  var objects = amf.objects;
  var materials = data.amfMaterials;
  var lastmaterial = null;
  function findMaterial(id) {
    if (lastmaterial && lastmaterial.id === id) {
      return lastmaterial;
    }
    for (var i = 0; i < materials.length; i++) {
      if (materials[i].id && materials[i].id === id) {
        lastmaterial = materials[i];
        return lastmaterial;
      }
    }
    return null;
  }
  function getValue(objects, type) {
    for (var i = 0; i < objects.length; i++) {
      if (objects[i].type === type) {
        return objects[i].value;
      }
    }
    return null;
  }
  function getColor(objects) {
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      if (obj.type === 'color') {
        var r = parseFloat(getValue(obj.objects, 'r'));
        var g = parseFloat(getValue(obj.objects, 'g'));
        var b = parseFloat(getValue(obj.objects, 'b'));
        var a = parseFloat(getValue(obj.objects, 'a'));
        if (Number.isNaN(r)) {
          r = 1.0;
        } // AMF default color
        if (Number.isNaN(g)) {
          g = 1.0;
        }
        if (Number.isNaN(b)) {
          b = 1.0;
        }
        if (Number.isNaN(a)) {
          a = 1.0;
        }
        return [r, g, b, a];
      }
    }
    return null;
  }
  function findColorByMaterial(id) {
    var m = findMaterial(id);
    if (m) {
      return getColor(m.objects);
    }
    return null;
  }

  // convert high level definitions
  function createDefinition(obj, didx) {
    // console.log(materials.length);
    switch (obj.type) {
      case 'object':
        createObject(obj, didx);
        break;
      case 'metadata':
        break;
      case 'material':
        break;
      default:
        console.log('Warning: unknown definition: ' + obj.type);
        break;
    }
  }
  // convert all objects to CSG based code
  function createObject(obj, oidx) {
    var vertices = []; // [x,y,z]
    var faces = []; // [v1,v2,v3]
    var colors = []; // [r,g,b,a]

    function addCoord(coord, cidx) {
      if (coord.type === 'coordinates') {
        var x = parseFloat(getValue(coord.objects, 'x'));
        var y = parseFloat(getValue(coord.objects, 'y'));
        var z = parseFloat(getValue(coord.objects, 'z'));
        // console.log('['+x+','+y+','+z+']');
        vertices.push([x, y, z]);
      }
      // normal is possible
    }
    function addVertex(vertex, vidx) {
      // console.log(vertex.type);
      if (vertex.type === 'vertex') {
        vertex.objects.map(addCoord);
      }
      // edge is possible
    }
    function addTriangle(tri, tidx) {
      if (tri.type === 'triangle') {
        var v1 = parseInt(getValue(tri.objects, 'v1'));
        var v2 = parseInt(getValue(tri.objects, 'v2'));
        var v3 = parseInt(getValue(tri.objects, 'v3'));
        // console.log('['+v1+','+v2+','+v3+']');
        faces.push([v1, v2, v3]); // HINT: reverse order for polyhedron()
        var c = getColor(tri.objects);
        if (c) {
          colors.push(c);
        } else {
          colors.push(tricolor);
        }
      }
    }
    var tricolor = null; // for found colors
    function addPart(part, pidx) {
      // console.log(part.type);
      switch (part.type) {
        case 'vertices':
          part.objects.map(addVertex, data);
          break;
        case 'volume':
          tricolor = getColor(part.objects);
          if (part.materialid) {
            // convert material to color
            tricolor = findColorByMaterial(part.materialid);
          }
          part.objects.map(addTriangle, data);
          break;
        default:
          break;
      }
    }
    function addMesh(mesh, midx) {
      // console.log(mesh.type);
      if (mesh.type === 'mesh') {
        mesh.objects.map(addPart, data);
      }
    }

    if (obj.objects.length > 0) {
      obj.objects.map(addMesh, data);

      var fcount = faces.length;
      var vcount = vertices.length;

      code += '// Object ' + obj.id + '\n';
      code += '//  faces   : ' + fcount + '\n';
      code += '//  vertices: ' + vcount + '\n';
      code += 'function createObject' + obj.id + '() {\n';
      code += '  var polys = [];\n';

      // convert the results into function calls
      for (var i = 0; i < fcount; i++) {
        code += '  polys.push(\n';
        code += '    PP([\n';
        for (var j = 0; j < faces[i].length; j++) {
          if (faces[i][j] < 0 || faces[i][j] >= vcount) {
            if (err.length === '') {
              err += 'bad index for vertice (out of range)';
            }
            continue;
          }
          if (j) {
            code += ',\n';
          }
          code += '      VV(' + vertices[faces[i][j]] + ')';
        }
        code += '])';
        if (colors[i]) {
          var c = colors[i];
          code += '.setColor([' + c[0] + ',' + c[1] + ',' + c[2] + ',' + c[3] + '])';
        }
        code += ');\n';
      }
      code += '  return CSG.fromPolygons(polys);\n';
      code += '}\n';
    }
  }

  // start everthing
  code = '// Objects  : ' + objects.length + '\n';
  code += '// Materials: ' + materials.length + '\n';
  code += '\n';
  code += '// helper functions\n';
  if (amf.scale !== 1.0) {
    code += 'var SCALE = ' + amf.scale + '; // scaling units (' + amf.unit + ')\n';
    code += 'var VV = function(x,y,z) { return new CSG.Vertex(new CSG.Vector3D(x*SCALE,y*SCALE,z*SCALE)); };\n';
  } else {
    code += 'var VV = function(x,y,z) { return new CSG.Vertex(new CSG.Vector3D(x,y,z)); };\n';
  }
  code += 'var PP = function(a) { return new CSG.Polygon(a); };\n';
  code += '\n';
  code += 'function main() {\n';
  code += '  var csgs = [];\n';
  for (var i = 0; i < objects.length; i++) {
    var obj = objects[i];
    if (obj.type === 'object') {
      code += '  csgs.push(createObject' + obj.id + '());\n';
    }
  }
  code += '  return union(csgs);\n';
  code += '}\n';
  code += '\n';

  objects.map(createDefinition, data);
  return code;
}

//
// Parse the given AMF source and return a JSCAD script
//
// fn (optional) original filename of AMF source
// options (optional) anonymous object with:
//   pxPmm: pixels per milimeter for calcuations
// FIXME: add openjscad version in a cleaner manner ?
function parseAMF(src, fn, options) {
  fn = fn || 'amf';
  var defaults = { version: '0.0.0' };
  options = Object.assign({}, defaults, options);
  var version = options.version;

  // parse the AMF source
  var parser = createAmfParser(src);
  // convert the internal objects to JSCAD code
  var code = '';
  code += '//\n';
  code += '// producer: OpenJSCAD.org ' + version + ' AMF Importer\n';
  code += '// date: ' + new Date() + '\n';
  code += '// source: ' + fn + '\n';
  code += '//\n';
  if (parser.amfObj !== null) {
    // console.log(JSON.stringify(parser.amfObj))
    // console.log(JSON.stringify(parser.amfMaterials))
    code += codify(parser.amfObj, parser);
  } else {
    console.log('Warning: AMF parsing failed');
  }
  return code;
}

function parseGCode(gcode, fn, options) {
  // http://reprap.org/wiki/G-code
  var defaults = { version: '0.0.0' };
  options = Object.assign({}, defaults, options);
  var version = options.version;
  // just as experiment ...
  var l = gcode.split(/[\n]/); // for now just GCODE ASCII
  var srci = '';
  var d = 0,
      pos = [],
      lpos = [],
      le = 0,
      ld = 0,
      p = [];
  var origin = [-100, -100];
  var layers = 0;
  var lh = 0.35,
      lz = 0;

  for (var i = 0; i < l.length; i++) {
    var val = '',
        k,
        e = 0;
    if (l[i].match(/^\s*;/)) {
      continue;
    }
    var c = l[i].split(/\s+/);
    for (var j = 0; j < c.length; j++) {
      if (c[j].match(/G(\d+)/)) {
        var n = parseInt(RegExp.$1);
        if (n == 1) {
          d++;
        }
        if (n == 90) {
          pos.type = 'abs';
        }
        if (n == 91) {
          pos.type = 'rel';
        }
      } else if (c[j].match(/M(\d+)/)) {
        var n = parseInt(RegExp.$1);
        if (n == 104 || n == 109) {
          k = 'temp';
        }
      } else if (c[j].match(/S([\d\.]+)/)) {
        var v = parseInt(RegExp.$1);
        if (k !== undefined) {
          val[k] = v;
        }
      } else if (c[j].match(/([XYZE])([\-\d\.]+)/)) {
        var a = RegExp.$1,
            v = parseFloat(RegExp.$2);
        if (pos.type == 'abs') {
          if (d) {
            pos[a] = v;
          }
        } else {
          if (d) {
            pos[a] += v;
          }
        }
        // console.log(d,a,pos.E,lpos.E);
        if (d && a == 'E' && lpos.E === undefined) {
          lpos.E = pos.E;
        }
        if (d && a == 'E' && pos.E - lpos.E > 0) {
          // console.log(pos.E,lpos.E);
          e++;
        }
      }
    }
    if (d && pos.X && pos.Y) {
      if (e) {
        if (!le && lpos.X && lpos.Y) {
          // console.log(lpos.X,lpos.Y);
          p.push('[' + (lpos.X + origin[0]) + ',' + (lpos.Y + origin[1]) + ']');
        }
        p.push('[' + (pos.X + origin[0]) + ',' + (pos.Y + origin[1]) + ']');
      }
      if (!e && le && p.length > 1) {
        if (srci.length) {
          srci += ',\n\t\t';
        }
        if (pos.Z != lz) {
          lh = pos.Z - lz;
          layers++;
        }
        srci += 'EX([' + p.join(', ') + '],{w: ' + lh * 1.1 + ', h:' + lh * 1.02 + ', fn:1, closed: false}).translate([0,0,' + pos['Z'] + '])';
        p = [];
        lz = pos.Z;
        // if(layers>2)
        //   break;
      }
      le = e;
      lpos.X = pos.X;
      lpos.Y = pos.Y;
      lpos.Z = pos.Z;
      lpos.E = pos.E;
    }
    ld = d;
  }

  var src = '';
  src += '// producer: OpenJSCAD Compatibility (' + version + ') GCode Importer\n';
  src += '// date: ' + new Date() + '\n';
  src += '// source: ' + fn + '\n';
  src += '\n';
  // if(err) src += "// WARNING: import errors: "+err+" (some triangles might be misaligned or missing)\n";
  src += '// layers: ' + layers + '\n';
  src += 'function main() {\n\tvar EX = function(p,opt) { return rectangular_extrude(p,opt); }\n\treturn [';
  src += srci;
  src += '\n\t];\n}\n';
  return src;
}

/*
## License

Copyright (c) 2016 Z3 Development https://github.com/z3dev

All code released under MIT license

History:
  2016/10/15: 0.5.2: initial version

Notes:
1) All functions extend other objects in order to maintain namespaces.
*/

// //////////////////////////////////////////
//
// JSON (JavaScript Object Notation) is a lightweight data-interchange format
// See http://json.org/
//
// //////////////////////////////////////////

function toSourceCSGVertex(ver) {
  return 'new CSG.Vertex(new CSG.Vector3D(' + ver._x + ',' + ver._y + ',' + ver._z + '))';
}

// convert the give CSG object to JSCAD source
function toSourceCSG(csg) {
  var code = '  var polygons = [];\n';
  csg.polygons.map(function (p) {
    code += '  poly = new CSG.Polygon([\n';
    for (var i = 0; i < p.vertices.length; i++) {
      code += '                         ' + toSourceCSGVertex(p.vertices[i].pos) + ',\n';
    }
    code += '                         ])';
    if (p.shared && p.shared.color && p.shared.color.length) {
      code += '.setColor(' + JSON.stringify(p.shared.color) + ');\n';
    } else {
      code += ';\n';
    }
    code += '  polygons.push(poly);\n';
  });
  code += '  return CSG.fromPolygons(polygons);\n';
  return code;
}

function toSourceCAGVertex(ver) {
  return 'new CAG.Vertex(new CSG.Vector2D(' + ver.pos._x + ',' + ver.pos._y + '))';
}
function toSourceSide(side) {
  return 'new CAG.Side(' + toSourceCAGVertex(side.vertex0) + ',' + toSourceCAGVertex(side.vertex1) + ')';
}

// convert the give CAG object to JSCAD source
function toSourceCAG(cag) {
  var code = '  var sides = [];\n';
  cag.sides.map(function (s) {
    code += '  sides.push(' + toSourceSide(s) + ');\n';
  });
  code += '  return CAG.fromSides(sides);\n';
  return code;
}

// convert an anonymous CSG/CAG object to JSCAD source
function toSource(obj) {
  if (obj.type && obj.type === 'csg') {
    var csg = _jscad_csg.CSG.fromObject(obj);
    return toSourceCSG(csg);
  }
  if (obj.type && obj.type === 'cag') {
    var cag = CAG.fromObject(obj);
    return toSourceCAG(cag);
  }
  return '';
}

//
// Parse the given JSON source and return a JSCAD script
//
// fn (optional) original filename of JSON source
//
function parseJSON(src, fn, options) {
  fn = fn || 'amf';
  var defaults = { version: '0.0.0' };
  options = Object.assign({}, defaults, options);
  var version = options.version;

  // convert the JSON into an anonymous object
  var obj = JSON.parse(src);
  // convert the internal objects to JSCAD code
  var code = '';
  code += '//\n';
  code += '// producer: OpenJSCAD.org ' + version + ' JSON Importer\n';
  code += '// date: ' + new Date() + '\n';
  code += '// source: ' + fn + '\n';
  code += '//\n';
  code += 'function main() {\n';
  code += toSource(obj);
  code += '};\n';
  return code;
}

// export the extended prototypes
// module.CAG = CAG;

function vt2jscad(v, t, n, c) {
  // vertices, triangles, normals and colors
  var src = '';
  src += 'polyhedron({ points: [\n\t';
  for (var i = 0, j = 0; i < v.length; i++) {
    if (j++) {
      src += ',\n\t';
    }
    src += '[' + v[i] + ']'; // .join(", ");
  }
  src += '],\n\tpolygons: [\n\t';
  for (var i = 0, j = 0; i < t.length; i++) {
    if (j++) {
      src += ',\n\t';
    }
    src += '[' + t[i] + ']'; // .join(', ');
  }
  if (c && t.length == c.length) {
    src += '],\n\tcolors: [\n\t';
    for (var i = 0, j = 0; i < c.length; i++) {
      if (j++) {
        src += ',\n\t';
      }
      src += '[' + c[i] + ']'; // .join(', ');
    }
  }
  src += '] })\n';
  return src;
}

function parseOBJ(obj, fn, options) {
  // http://en.wikipedia.org/wiki/Wavefront_.obj_file
  var defaults = { version: '0.0.0' };
  options = Object.assign({}, defaults, options);
  var version = options.version;

  var l = obj.split(/\n/);
  var v = [],
      f = [];

  for (var i = 0; i < l.length; i++) {
    var s = l[i];
    var a = s.split(/\s+/);

    if (a[0] == 'v') {
      v.push([a[1], a[2], a[3]]);
    } else if (a[0] == 'f') {
      var fc = [];
      var skip = 0;

      for (var j = 1; j < a.length; j++) {
        var c = a[j];
        c = c.replace(/\/.*$/, ''); // -- if coord# is '840/840' -> 840
        c--; // -- starts with 1, but we start with 0
        if (c >= v.length) {
          skip++;
        }
        if (skip == 0) {
          fc.push(c);
        }
      }
      // fc.reverse();
      if (skip == 0) {
        f.push(fc);
      }
    } else {
      // vn vt and all others disregarded
    }
  }
  var src = '';
  src += '// producer: OpenJSCAD Compatibility (' + version + ') Wavefront OBJ Importer\n';
  src += '// date: ' + new Date() + '\n';
  src += '// source: ' + fn + '\n';
  src += '\n';
  // if(err) src += "// WARNING: import errors: "+err+" (some triangles might be misaligned or missing)\n";
  src += '// objects: 1\n// object #1: polygons: ' + f.length + '\n\n';
  src += 'function main() { return ';
  src += vt2jscad(v, f);
  src += '; }';
  return src;
}

// STL function from http://jsfiddle.net/Riham/yzvGD/35/
// CC BY-SA by Riham
// changes by Rene K. Mueller <spiritdude@gmail.com>
//
// 2013/03/28: lot of rework and debugging included, and error handling
// 2013/03/18: renamed functions, creating .jscad source direct via polyhedron()
var echo = console.info;

function parseSTL(stl, fn, options) {
  var defaults = { version: '0.0.0' };
  options = Object.assign({}, defaults, options);
  var version = options.version;

  var isAscii = true;

  for (var i = 0; i < stl.length; i++) {
    if (stl[i].charCodeAt(0) == 0) {
      isAscii = false;
      break;
    }
  }
  var src;
  if (!isAscii) {
    src = parseBinarySTL(stl, fn, version);
  } else {
    src = parseAsciiSTL(stl, fn, version);
  }
  return src;
}

function parseBinarySTL(stl, fn, version) {
  // -- This makes more sense if you read http://en.wikipedia.org/wiki/STL_(file_format)#Binary_STL
  var vertices = [];
  var triangles = [];
  var normals = [];
  var colors = [];
  var vertexIndex = 0;
  var converted = 0;
  var err = 0;
  var mcolor = null;
  var umask = parseInt('01000000000000000', 2);
  var rmask = parseInt('00000000000011111', 2);
  var gmask = parseInt('00000001111100000', 2);
  var bmask = parseInt('00111110000000000', 2);
  var br = new BinaryReader(stl);

  var m = 0,
      c = 0,
      r = 0,
      g = 0,
      b = 0,
      a = 0;
  for (var i = 0; i < 80; i++) {
    switch (m) {
      case 6:
        r = br.readUInt8();
        m += 1;
        continue;
      case 7:
        g = br.readUInt8();
        m += 1;
        continue;
      case 8:
        b = br.readUInt8();
        m += 1;
        continue;
      case 9:
        a = br.readUInt8();
        m += 1;
        continue;
      default:
        c = br.readChar();
        switch (c) {
          case 'C':
          case 'O':
          case 'L':
          case 'R':
          case '=':
            m += 1;
          default:
            break;
        }
        break;
    }
  }
  if (m == 10) {
    // create the default color
    mcolor = [r / 255, g / 255, b / 255, a / 255];
  }

  var totalTriangles = br.readUInt32(); // Read # triangles

  for (var tr = 0; tr < totalTriangles; tr++) {
    // if(tr%100==0) status('stl importer: converted '+converted+' out of '+totalTriangles+' triangles');
    /*
         REAL32[3] . Normal vector
         REAL32[3] . Vertex 1
         REAL32[3] . Vertex 2
         REAL32[3] . Vertex 3
            UINT16 . Attribute byte count */
    // -- Parse normal
    var no = [];no.push(br.readFloat());no.push(br.readFloat());no.push(br.readFloat());

    // -- Parse every 3 subsequent floats as a vertex
    var v1 = [];v1.push(br.readFloat());v1.push(br.readFloat());v1.push(br.readFloat());
    var v2 = [];v2.push(br.readFloat());v2.push(br.readFloat());v2.push(br.readFloat());
    var v3 = [];v3.push(br.readFloat());v3.push(br.readFloat());v3.push(br.readFloat());

    var skip = 0;
    {
      for (var i = 0; i < 3; i++) {
        if (isNaN(v1[i])) {
          skip++;
        }
        if (isNaN(v2[i])) {
          skip++;
        }
        if (isNaN(v3[i])) {
          skip++;
        }
        if (isNaN(no[i])) {
          skip++;
        }
      }
      if (skip > 0) {
        echo('bad triangle vertice coords/normal: ', skip);
      }
    }
    err += skip;
    // -- every 3 vertices create a triangle.
    var triangle = [];triangle.push(vertexIndex++);triangle.push(vertexIndex++);triangle.push(vertexIndex++);

    var abc = br.readUInt16();
    var color = null;
    if (m == 10) {
      var u = abc & umask; // 0 if color is unique for this triangle
      var r = (abc & rmask) / 31;
      var g = ((abc & gmask) >>> 5) / 31;
      var b = ((abc & bmask) >>> 10) / 31;
      var a = 255;
      if (u == 0) {
        color = [r, g, b, a];
      } else {
        color = mcolor;
      }
      colors.push(color);
    }

    // -- Add 3 vertices for every triangle
    // -- TODO: OPTIMIZE: Check if the vertex is already in the array, if it is just reuse the index
    if (skip == 0) {
      // checking cw vs ccw, given all normal/vertice are valid
      // E1 = B - A
      // E2 = C - A
      // test = dot( Normal, cross( E1, E2 ) )
      // test > 0: cw, test < 0 : ccw
      var w1 = new _jscad_csg.CSG.Vector3D(v1);
      var w2 = new _jscad_csg.CSG.Vector3D(v2);
      var w3 = new _jscad_csg.CSG.Vector3D(v3);
      var e1 = w2.minus(w1);
      var e2 = w3.minus(w1);
      var t = new _jscad_csg.CSG.Vector3D(no).dot(e1.cross(e2));
      if (t > 0) {
        // 1,2,3 -> 3,2,1
        var tmp = v3;
        v3 = v1;
        v1 = tmp;
      }
    }
    vertices.push(v1);
    vertices.push(v2);
    vertices.push(v3);
    triangles.push(triangle);
    normals.push(no);
    converted++;
  }
  var src = '';
  src += '// producer: OpenJSCAD Compatibility (' + version + ') STL Binary Importer\n';
  src += '// date: ' + new Date() + '\n';
  src += '// source: ' + fn + '\n';
  src += '\n';
  if (err) {
    src += '// WARNING: import errors: ' + err + ' (some triangles might be misaligned or missing)\n';
  }
  src += '// objects: 1\n// object #1: triangles: ' + totalTriangles + '\n\n';
  src += 'function main() { return ';
  src += vt2jscad(vertices, triangles, normals, colors);
  src += '; }';
  return src;
}

function parseAsciiSTL(stl, fn, version) {
  var src = '';
  var n = 0;
  var converted = 0;
  var o;

  src += '// producer: OpenJSCAD Compatibility (' + version + ') STL ASCII Importer\n';
  src += '// date: ' + new Date() + '\n';
  src += '// source: ' + fn + '\n';
  src += '\n';
  src += 'function main() { return union(\n';
  // -- Find all models
  var objects = stl.split('endsolid');
  src += '// objects: ' + (objects.length - 1) + '\n';

  for (o = 1; o < objects.length; o++) {
    // -- Translation: a non-greedy regex for facet {...} endloop pattern
    var patt = /\bfacet[\s\S]*?endloop/mgi;
    var vertices = [];
    var triangles = [];
    var normals = [];
    var vertexIndex = 0;
    var err = 0;

    var match = stl.match(patt);
    if (match == null) {
      continue;
    }
    for (var i = 0; i < match.length; i++) {
      // if(converted%100==0) status('stl to jscad: converted '+converted+' out of '+match.length+ ' facets');
      // -- 1 normal with 3 numbers, 3 different vertex objects each with 3 numbers:
      // var vpatt = /\bfacet\s+normal\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*outer\s+loop\s+vertex\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*vertex\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*vertex\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/mgi;
      // (-?\d+\.?\d*) -1.21223
      // (-?\d+\.?\d*[Ee]?[-+]?\d*)
      var vpatt = /\bfacet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)\s+outer\s+loop\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s*/mgi;
      var v = vpatt.exec(match[i]);
      if (v == null) {
        continue;
      }
      if (v.length != 13) {
        echo('Failed to parse ' + match[i]);
        break;
      }
      var skip = 0;
      for (var k = 0; k < v.length; k++) {
        if (v[k] == 'NaN') {
          echo('bad normal or triangle vertice #' + converted + ' ' + k + ": '" + v[k] + "', skipped");
          skip++;
        }
      }
      err += skip;
      if (skip) {
        continue;
      }
      if (0 && skip) {
        var j = 1 + 3;
        var v1 = [];v1.push(parseFloat(v[j++]));v1.push(parseFloat(v[j++]));v1.push(parseFloat(v[j++]));
        var v2 = [];v2.push(parseFloat(v[j++]));v2.push(parseFloat(v[j++]));v2.push(parseFloat(v[j++]));
        var v3 = [];v3.push(parseFloat(v[j++]));v3.push(parseFloat(v[j++]));v3.push(parseFloat(v[j++]));
        echo('recalculate norm', v1, v2, v3);
        var w1 = new _jscad_csg.CSG.Vector3D(v1);
        var w2 = new _jscad_csg.CSG.Vector3D(v2);
        var w3 = new _jscad_csg.CSG.Vector3D(v3);
        var _u = w1.minus(w3);
        var _v = w1.minus(w2);
        var norm = _u.cross(_v).unit();
        j = 1;
        v[j++] = norm._x;
        v[j++] = norm._y;
        v[j++] = norm._z;
        skip = false;
      }
      var j = 1;
      var no = [];no.push(parseFloat(v[j++]));no.push(parseFloat(v[j++]));no.push(parseFloat(v[j++]));
      var v1 = [];v1.push(parseFloat(v[j++]));v1.push(parseFloat(v[j++]));v1.push(parseFloat(v[j++]));
      var v2 = [];v2.push(parseFloat(v[j++]));v2.push(parseFloat(v[j++]));v2.push(parseFloat(v[j++]));
      var v3 = [];v3.push(parseFloat(v[j++]));v3.push(parseFloat(v[j++]));v3.push(parseFloat(v[j++]));
      var triangle = [];triangle.push(vertexIndex++);triangle.push(vertexIndex++);triangle.push(vertexIndex++);

      // -- Add 3 vertices for every triangle
      //    TODO: OPTIMIZE: Check if the vertex is already in the array, if it is just reuse the index
      if (skip == 0) {
        // checking cw vs ccw
        // E1 = B - A
        // E2 = C - A
        // test = dot( Normal, cross( E1, E2 ) )
        // test > 0: cw, test < 0: ccw
        var w1 = new _jscad_csg.CSG.Vector3D(v1);
        var w2 = new _jscad_csg.CSG.Vector3D(v2);
        var w3 = new _jscad_csg.CSG.Vector3D(v3);
        var e1 = w2.minus(w1);
        var e2 = w3.minus(w1);
        var t = new _jscad_csg.CSG.Vector3D(no).dot(e1.cross(e2));
        if (t > 0) {
          // 1,2,3 -> 3,2,1
          var tmp = v3;
          v3 = v1;
          v1 = tmp;
        }
      }
      vertices.push(v1);
      vertices.push(v2);
      vertices.push(v3);
      normals.push(no);
      triangles.push(triangle);
      converted++;
    }
    if (n++) {
      src += ',';
    }
    if (err) {
      src += '// WARNING: import errors: ' + err + ' (some triangles might be misaligned or missing)\n';
    }
    src += '// object #' + o + ': triangles: ' + match.length + '\n';
    src += vt2jscad(vertices, triangles, normals);
  }
  src += '); }\n';
  return src;
}

// BinaryReader
// Refactored by Vjeux <vjeuxx@gmail.com>
// http://blog.vjeux.com/2010/javascript/javascript-binary-reader.html

// Original
// + Jonas Raoni Soares Silva
// @ http://jsfromhell.com/classes/binary-parser [rev. #1]

function BinaryReader(data) {
  this._buffer = data;
  this._pos = 0;
}

BinaryReader.prototype = {

  /* Public */

  readInt8: function readInt8() {
    return this._decodeInt(8, true);
  },
  readUInt8: function readUInt8() {
    return this._decodeInt(8, false);
  },
  readInt16: function readInt16() {
    return this._decodeInt(16, true);
  },
  readUInt16: function readUInt16() {
    return this._decodeInt(16, false);
  },
  readInt32: function readInt32() {
    return this._decodeInt(32, true);
  },
  readUInt32: function readUInt32() {
    return this._decodeInt(32, false);
  },

  readFloat: function readFloat() {
    return this._decodeFloat(23, 8);
  },
  readDouble: function readDouble() {
    return this._decodeFloat(52, 11);
  },

  readChar: function readChar() {
    return this.readString(1);
  },
  readString: function readString(length) {
    this._checkSize(length * 8);
    var result = this._buffer.substr(this._pos, length);
    this._pos += length;
    return result;
  },

  seek: function seek(pos) {
    this._pos = pos;
    this._checkSize(0);
  },

  getPosition: function getPosition() {
    return this._pos;
  },

  getSize: function getSize() {
    return this._buffer.length;
  },

  /* Private */

  _decodeFloat: function _decodeFloat(precisionBits, exponentBits) {
    var this$1 = this;

    var length = precisionBits + exponentBits + 1;
    var size = length >> 3;
    this._checkSize(length);

    var bias = Math.pow(2, exponentBits - 1) - 1;
    var signal = this._readBits(precisionBits + exponentBits, 1, size);
    var exponent = this._readBits(precisionBits, exponentBits, size);
    var significand = 0;
    var divisor = 2;
    var curByte = 0; // length + (-precisionBits >> 3) - 1;
    do {
      var byteValue = this$1._readByte(++curByte, size);
      var startBit = precisionBits % 8 || 8;
      var mask = 1 << startBit;
      while (mask >>= 1) {
        if (byteValue & mask) {
          significand += 1 / divisor;
        }
        divisor *= 2;
      }
    } while (precisionBits -= startBit);

    this._pos += size;

    return exponent == (bias << 1) + 1 ? significand ? NaN : signal ? -Infinity : +Infinity : (1 + signal * -2) * (exponent || significand ? !exponent ? Math.pow(2, -bias + 1) * significand : Math.pow(2, exponent - bias) * (1 + significand) : 0);
  },

  _decodeInt: function _decodeInt(bits, signed) {
    var x = this._readBits(0, bits, bits / 8),
        max = Math.pow(2, bits);
    var result = signed && x >= max / 2 ? x - max : x;

    this._pos += bits / 8;
    return result;
  },

  // shl fix: Henri Torgemane ~1996 (compressed by Jonas Raoni)
  _shl: function _shl(a, b) {
    for (++b; --b; a = ((a %= 0x7fffffff + 1) & 0x40000000) == 0x40000000 ? a * 2 : (a - 0x40000000) * 2 + 0x7fffffff + 1) {}
    return a;
  },

  _readByte: function _readByte(i, size) {
    return this._buffer.charCodeAt(this._pos + size - i - 1) & 0xff;
  },

  _readBits: function _readBits(start, length, size) {
    var this$1 = this;

    var offsetLeft = (start + length) % 8;
    var offsetRight = start % 8;
    var curByte = size - (start >> 3) - 1;
    var lastByte = size + (-(start + length) >> 3);
    var diff = curByte - lastByte;

    var sum = this._readByte(curByte, size) >> offsetRight & (1 << (diff ? 8 - offsetRight : length)) - 1;

    if (diff && offsetLeft) {
      sum += (this._readByte(lastByte++, size) & (1 << offsetLeft) - 1) << (diff-- << 3) - offsetRight;
    }

    while (diff) {
      sum += this$1._shl(this$1._readByte(lastByte++, size), (diff-- << 3) - offsetRight);
    }

    return sum;
  },

  _checkSize: function _checkSize(neededBits) {
    if (!(this._pos + Math.ceil(neededBits / 8) < this._buffer.length)) {
      // throw new Error("Index out of bound");
    }
  }
};

/*
## License

Copyright (c) 2016 Z3 Development https://github.com/z3dev

All code released under MIT license

Notes:
1) All functions extend other objects in order to maintain namespaces.
*/
var sax$3 = require('sax');

// //////////////////////////////////////////
//
// SVG is a language for describing two-dimensional graphics in XML
// See http://www.w3.org/TR/SVG/Overview.html
//
// //////////////////////////////////////////

// standard pixel size at arms length on 90dpi screens
var cssPxUnit = 0.2822222;

// units for converting CSS2 points/length, i.e. CSS2 value / pxPmm
sax$3.SAXParser.prototype.pxPmm = 1 / 0.2822222; // used for scaling SVG coordinates(PX) to CAG coordinates(MM)
var inchMM$1 = 1 / (1 / 0.039370); // used for scaling SVG coordinates(IN) to CAG coordinates(MM)
var ptMM = 1 / (1 / 0.039370 / 72); // used for scaling SVG coordinates(IN) to CAG coordinates(MM)
var pcMM = 1 / (1 / 0.039370 / 72 * 12); // used for scaling SVG coordinates(PC) to CAG coordinates(MM)

// standard SVG named colors (sRGB values)
var svgColors = {
  'aliceblue': [240, 248, 255],
  'antiquewhite': [250, 235, 215],
  'aqua': [0, 255, 255],
  'aquamarine': [127, 255, 212],
  'azure': [240, 255, 255],
  'beige': [245, 245, 220],
  'bisque': [255, 228, 196],
  'black': [0, 0, 0],
  'blanchedalmond': [255, 235, 205],
  'blue': [0, 0, 255],
  'blueviolet': [138, 43, 226],
  'brown': [165, 42, 42],
  'burlywood': [222, 184, 135],
  'cadetblue': [95, 158, 160],
  'chartreuse': [127, 255, 0],
  'chocolate': [210, 105, 30],
  'coral': [255, 127, 80],
  'cornflowerblue': [100, 149, 237],
  'cornsilk': [255, 248, 220],
  'crimson': [220, 20, 60],
  'cyan': [0, 255, 255],
  'darkblue': [0, 0, 139],
  'darkcyan': [0, 139, 139],
  'darkgoldenrod': [184, 134, 11],
  'darkgray': [169, 169, 169],
  'darkgreen': [0, 100, 0],
  'darkgrey': [169, 169, 169],
  'darkkhaki': [189, 183, 107],
  'darkmagenta': [139, 0, 139],
  'darkolivegreen': [85, 107, 47],
  'darkorange': [255, 140, 0],
  'darkorchid': [153, 50, 204],
  'darkred': [139, 0, 0],
  'darksalmon': [233, 150, 122],
  'darkseagreen': [143, 188, 143],
  'darkslateblue': [72, 61, 139],
  'darkslategray': [47, 79, 79],
  'darkslategrey': [47, 79, 79],
  'darkturquoise': [0, 206, 209],
  'darkviolet': [148, 0, 211],
  'deeppink': [255, 20, 147],
  'deepskyblue': [0, 191, 255],
  'dimgray': [105, 105, 105],
  'dimgrey': [105, 105, 105],
  'dodgerblue': [30, 144, 255],
  'firebrick': [178, 34, 34],
  'floralwhite': [255, 250, 240],
  'forestgreen': [34, 139, 34],
  'fuchsia': [255, 0, 255],
  'gainsboro': [220, 220, 220],
  'ghostwhite': [248, 248, 255],
  'gold': [255, 215, 0],
  'goldenrod': [218, 165, 32],
  'gray': [128, 128, 128],
  'grey': [128, 128, 128],
  'green': [0, 128, 0],
  'greenyellow': [173, 255, 47],
  'honeydew': [240, 255, 240],
  'hotpink': [255, 105, 180],
  'indianred': [205, 92, 92],
  'indigo': [75, 0, 130],
  'ivory': [255, 255, 240],
  'khaki': [240, 230, 140],
  'lavender': [230, 230, 250],
  'lavenderblush': [255, 240, 245],
  'lawngreen': [124, 252, 0],
  'lemonchiffon': [255, 250, 205],
  'lightblue': [173, 216, 230],
  'lightcoral': [240, 128, 128],
  'lightcyan': [224, 255, 255],
  'lightgoldenrodyellow': [250, 250, 210],
  'lightgray': [211, 211, 211],
  'lightgreen': [144, 238, 144],
  'lightgrey': [211, 211, 211],
  'lightpink': [255, 182, 193],
  'lightsalmon': [255, 160, 122],
  'lightseagreen': [32, 178, 170],
  'lightskyblue': [135, 206, 250],
  'lightslategray': [119, 136, 153],
  'lightslategrey': [119, 136, 153],
  'lightsteelblue': [176, 196, 222],
  'lightyellow': [255, 255, 224],
  'lime': [0, 255, 0],
  'limegreen': [50, 205, 50],
  'linen': [250, 240, 230],
  'magenta': [255, 0, 255],
  'maroon': [128, 0, 0],
  'mediumaquamarine': [102, 205, 170],
  'mediumblue': [0, 0, 205],
  'mediumorchid': [186, 85, 211],
  'mediumpurple': [147, 112, 219],
  'mediumseagreen': [60, 179, 113],
  'mediumslateblue': [123, 104, 238],
  'mediumspringgreen': [0, 250, 154],
  'mediumturquoise': [72, 209, 204],
  'mediumvioletred': [199, 21, 133],
  'midnightblue': [25, 25, 112],
  'mintcream': [245, 255, 250],
  'mistyrose': [255, 228, 225],
  'moccasin': [255, 228, 181],
  'navajowhite': [255, 222, 173],
  'navy': [0, 0, 128],
  'oldlace': [253, 245, 230],
  'olive': [128, 128, 0],
  'olivedrab': [107, 142, 35],
  'orange': [255, 165, 0],
  'orangered': [255, 69, 0],
  'orchid': [218, 112, 214],
  'palegoldenrod': [238, 232, 170],
  'palegreen': [152, 251, 152],
  'paleturquoise': [175, 238, 238],
  'palevioletred': [219, 112, 147],
  'papayawhip': [255, 239, 213],
  'peachpuff': [255, 218, 185],
  'peru': [205, 133, 63],
  'pink': [255, 192, 203],
  'plum': [221, 160, 221],
  'powderblue': [176, 224, 230],
  'purple': [128, 0, 128],
  'red': [255, 0, 0],
  'rosybrown': [188, 143, 143],
  'royalblue': [65, 105, 225],
  'saddlebrown': [139, 69, 19],
  'salmon': [250, 128, 114],
  'sandybrown': [244, 164, 96],
  'seagreen': [46, 139, 87],
  'seashell': [255, 245, 238],
  'sienna': [160, 82, 45],
  'silver': [192, 192, 192],
  'skyblue': [135, 206, 235],
  'slateblue': [106, 90, 205],
  'slategray': [112, 128, 144],
  'slategrey': [112, 128, 144],
  'snow': [255, 250, 250],
  'springgreen': [0, 255, 127],
  'steelblue': [70, 130, 180],
  'tan': [210, 180, 140],
  'teal': [0, 128, 128],
  'thistle': [216, 191, 216],
  'tomato': [255, 99, 71],
  'turquoise': [64, 224, 208],
  'violet': [238, 130, 238],
  'wheat': [245, 222, 179],
  'white': [255, 255, 255],
  'whitesmoke': [245, 245, 245],
  'yellow': [255, 255, 0],
  'yellowgreen': [154, 205, 50]
};

// Calculate the CAG length/size from the given SVG value (float)
sax$3.SAXParser.prototype.svg2cagX = function (v) {
  return v / this.svgUnitsPmm[0];
};

sax$3.SAXParser.prototype.svg2cagY = function (v) {
  return 0 - v / this.svgUnitsPmm[1];
};

// Calculate the CAG length/size from the given CSS value (string)
sax$3.SAXParser.prototype.cagLengthX = function (css) {
  if (css.indexOf('%') < 0) {
    return this.css2cag(css, this.svgUnitsPmm[0]);
  }
  // calculate the units as a percentage of the width
  var v = parseFloat(css); // number part
  if (isNaN(v)) {
    return 0.0;
  }
  if (v == 0) {
    return v;
  }
  v = v / 100 * this.svgUnitsX;
  // convert the units to mm
  v = v / this.svgUnitsPmm[0];
  // return v;
  return Math.round(v / -100000) * -100000;
};

sax$3.SAXParser.prototype.cagLengthY = function (css) {
  if (css.indexOf('%') < 0) {
    return this.css2cag(css, this.svgUnitsPmm[1]);
  }
  // calculate the units as a percentage of the width
  var v = parseFloat(css); // number part
  if (isNaN(v)) {
    return 0.0;
  }
  if (v == 0) {
    return v;
  }
  v = v / 100 * this.svgUnitsY;
  // convert the units to mm
  v = v / this.svgUnitsPmm[1];
  // return v;
  return Math.round(v / -100000) * -100000;
};

sax$3.SAXParser.prototype.cagLengthP = function (css) {
  if (css.indexOf('%') < 0) {
    return this.css2cag(css, this.svgUnitsPmm[1]);
  }
  // calculate the units as a percentage of the viewport
  var v = parseFloat(css); // number part
  if (isNaN(v)) {
    return 0.0;
  }
  if (v == 0) {
    return v;
  }
  v = v / 100 * this.svgUnitsV;
  // convert the units to mm
  v = v / this.svgUnitsPmm[0]; // FIXME should this use X units?
  return v;
};

sax$3.SAXParser.prototype.css2cag = function (css, unit) {
  // console.log('css2cag('+css+','+unit+')');
  var v = parseFloat(css); // number part
  if (isNaN(v)) {
    return 0.0;
  }
  if (v == 0) {
    return v;
  }
  if (css.search(/EM/i) > 0) {
    v = v; // font size
  } else if (css.search(/EX/i) > 0) {
    v = v; // x-height of font
  } else if (css.search(/MM/i) > 0) {
    v = v; // absolute millimeters
  } else if (css.search(/CM/i) > 0) {
    v = v * 10; // absolute centimeters > millimeters
  } else if (css.search(/IN/i) > 0) {
    v = v / inchMM$1; // absolute inches > millimeters
  } else if (css.search(/PT/i) > 0) {
    v = v / ptMM; // absolute points > millimeters
  } else if (css.search(/PC/i) > 0) {
    v = v / pcMM; // absolute picas > millimeters
  } else {
    v = v / unit; // absolute pixels(units) > millimeters
  }
  // console.log('v ('+v+')');
  return v;
};

// convert the SVG color specification to CAG RGB
sax$3.SAXParser.prototype.cagColor = function (value) {
  //  var rgb = [0,0,0]; // default is black
  var rgb = null;
  value = value.toLowerCase();
  if (value in svgColors) {
    rgb = svgColors[value];
    rgb = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]; // converted to 0.0-1.0 values
  } else {
    if (value[0] == '#') {
      if (value.length == 4) {
        // short HEX specification
        value = '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
      }
      if (value.length == 7) {
        // HEX specification
        rgb = [parseInt('0x' + value.slice(1, 3)) / 255, parseInt('0x' + value.slice(3, 5)) / 255, parseInt('0x' + value.slice(5, 7)) / 255];
      }
    } else {
      var pat = /rgb\(.+,.+,.+\)/;
      var s = pat.exec(value);
      if (s !== null) {
        // RGB specification
        s = s[0];
        s = s.slice(s.indexOf('(') + 1, s.indexOf(')'));
        rgb = s.split(',');
        if (s.indexOf('%') > 0) {
          // rgb(#%,#%,#%)
          rgb = [parseInt(rgb[0]), parseInt(rgb[1]), parseInt(rgb[2])];
          rgb = [rgb[0] / 100, rgb[1] / 100, rgb[2] / 100]; // converted to 0.0-1.0 values
        } else {
          // rgb(#,#,#)
          rgb = [parseInt(rgb[0]), parseInt(rgb[1]), parseInt(rgb[2])];
          rgb = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]; // converted to 0.0-1.0 values
        }
      }
    }
  }
  return rgb;
};

sax$3.SAXParser.prototype.cssStyle = function (element, name) {
  if ('STYLE' in element) {
    var list = element.STYLE;
    var pat = name + '\\s*:\\s*\\S+;';
    var exp = new RegExp(pat, 'i');
    var v = exp.exec(list);
    if (v !== null) {
      v = v[0];
      var i = v.length;
      while (v[i] != ' ') {
        i--;
      }
      v = v.slice(i + 1, v.length - 1);
      return v;
    }
  }
  return null;
};

sax$3.SAXParser.prototype.svgCore = function (obj, element) {
  if ('ID' in element) {
    obj.id = element.ID;
  }
};

sax$3.SAXParser.prototype.svgPresentation = function (obj, element) {
  // presentation attributes for all
  if ('DISPLAY' in element) {
    obj.visible = element.DISPLAY;
  }
  // presentation attributes for solids
  if ('COLOR' in element) {
    obj.fill = this.cagColor(element.COLOR);
  }
  if ('OPACITY' in element) {
    obj.opacity = element.OPACITY;
  }
  if ('FILL' in element) {
    obj.fill = this.cagColor(element.FILL);
  } else {
    var s = this.cssStyle(element, 'fill');
    if (s !== null) {
      obj.fill = this.cagColor(s);
    }
  }
  if ('FILL-OPACITY' in element) {
    obj.opacity = element['FILL-OPACITY'];
  }
  // presentation attributes for lines
  if ('STROKE-WIDTH' in element) {
    obj.strokeWidth = element['STROKE-WIDTH'];
  } else {
    var sw = this.cssStyle(element, 'stroke-width');
    if (sw !== null) {
      obj.strokeWidth = sw;
    }
  }
  if ('STROKE' in element) {
    obj.stroke = this.cagColor(element.STROKE);
  } else {
    var s = this.cssStyle(element, 'stroke');
    if (s !== null) {
      obj.stroke = this.cagColor(s);
    }
  }
  if ('STROKE-OPACITY' in element) {
    obj.strokeOpacity = element['STROKE-OPACITY'];
  }
};

sax$3.SAXParser.prototype.svgTransforms = function (cag, element) {
  var list = null;
  if ('TRANSFORM' in element) {
    list = element.TRANSFORM;
  } else {
    var s = this.cssStyle(element, 'transform');
    if (s !== null) {
      list = s;
    }
  }
  if (list !== null) {
    cag.transforms = [];
    var exp = new RegExp('\\w+\\(.+\\)', 'i');
    var v = exp.exec(list);
    while (v !== null) {
      var s = exp.lastIndex;
      var e = list.indexOf(')') + 1;
      var t = list.slice(s, e); // the transform
      t = t.trim();
      // add the transform to the CAG
      // which are applied in the order provided
      var n = t.slice(0, t.indexOf('('));
      var a = t.slice(t.indexOf('(') + 1, t.indexOf(')')).trim();
      if (a.indexOf(',') > 0) {
        a = a.split(',');
      } else {
        a = a.split(' ');
      }
      switch (n) {
        case 'translate':
          var o = { translate: [a[0], a[1]] };
          cag.transforms.push(o);
          break;
        case 'scale':
          if (a.length == 1) {
            a.push(a[0]);
          } // as per SVG
          var o = { scale: [a[0], a[1]] };
          cag.transforms.push(o);
          break;
        case 'rotate':
          var o = { rotate: a };
          cag.transforms.push(o);
          break;
        // case 'matrix':
        // case 'skewX':
        // case 'skewY':
        default:
          break;
      }
      // shorten the list and continue
      list = list.slice(e, list.length);
      v = exp.exec(list);
    }
  }
};

sax$3.SAXParser.prototype.svgSvg = function (element) {
  // default SVG with no viewport
  var obj = { type: 'svg', x: 0, y: 0, width: '100%', height: '100%', strokeWidth: '1' };

  // default units per mm
  obj.unitsPmm = [this.pxPmm, this.pxPmm];

  if ('PXPMM' in element) {
    // WOW! a supplied value for pixels per milimeter!!!
    obj.pxPmm = element.PXPMM;
    obj.unitsPmm = [obj.pxPmm, obj.pxPmm];
  }
  if ('WIDTH' in element) {
    obj.width = element.WIDTH;
  }
  if ('HEIGHT' in element) {
    obj.height = element.HEIGHT;
  }
  if ('VIEWBOX' in element) {
    var list = element.VIEWBOX.trim();
    var exp = new RegExp('([\\d\\.\\-]+)[\\s,]+([\\d\\.\\-]+)[\\s,]+([\\d\\.\\-]+)[\\s,]+([\\d\\.\\-]+)', 'i');
    var v = exp.exec(list);
    if (v !== null) {
      obj.viewX = parseFloat(v[1]);
      obj.viewY = parseFloat(v[2]);
      obj.viewW = parseFloat(v[3]);
      obj.viewH = parseFloat(v[4]);
    }
    // apply the viewbox
    if (obj.width.indexOf('%') < 0) {
      // calculate a scaling from width and viewW
      var s = this.css2cag(obj.width, this.pxPmm); // width in millimeters
      s = obj.viewW / s;
      // scale the default units
      // obj.unitsPmm[0] = obj.unitsPmm[0] * s;
      obj.unitsPmm[0] = s;
    } else {
      // scale the default units by the width (%)
      var u = obj.unitsPmm[0] * (parseFloat(obj.width) / 100.0);
      obj.unitsPmm[0] = u;
    }
    if (obj.height.indexOf('%') < 0) {
      // calculate a scaling from height and viewH
      var s = this.css2cag(obj.height, this.pxPmm); // height in millimeters
      s = obj.viewH / s;
      // scale the default units
      // obj.unitsPmm[1] = obj.unitsPmm[1] * s;
      obj.unitsPmm[1] = s;
    } else {
      // scale the default units by the width (%)
      var u = obj.unitsPmm[1] * (parseFloat(obj.height) / 100.0);
      obj.unitsPmm[1] = u;
    }
  } else {
    obj.viewX = 0;
    obj.viewY = 0;
    obj.viewW = 1920 / obj.unitsPmm[0]; // average screen size / pixels per unit
    obj.viewH = 1080 / obj.unitsPmm[1]; // average screen size / pixels per unit
  }
  obj.viewP = Math.sqrt(obj.viewW * obj.viewW + obj.viewH * obj.viewH) / Math.SQRT2;

  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);

  obj.objects = [];
  // console.log(JSON.stringify(obj));
  return obj;
};

sax$3.SAXParser.prototype.svgEllipse = function (element) {
  var obj = { type: 'ellipse', cx: '0', cy: '0', rx: '0', ry: '0' };
  if ('CX' in element) {
    obj.cx = element.CX;
  }
  if ('CY' in element) {
    obj.cy = element.CY;
  }
  if ('RX' in element) {
    obj.rx = element.RX;
  }
  if ('RY' in element) {
    obj.ry = element.RY;
  }
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);
  return obj;
};

sax$3.SAXParser.prototype.svgLine = function (element) {
  var obj = { type: 'line', x1: '0', y1: '0', x2: '0', y2: '0' };
  if ('X1' in element) {
    obj.x1 = element.X1;
  }
  if ('Y1' in element) {
    obj.y1 = element.Y1;
  }
  if ('X2' in element) {
    obj.x2 = element.X2;
  }
  if ('Y2' in element) {
    obj.y2 = element.Y2;
  }
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);
  return obj;
};

sax$3.SAXParser.prototype.svgListOfPoints = function (list) {
  var points = [];
  var exp = new RegExp('([\\d\\-\\+\\.]+)[\\s,]+([\\d\\-\\+\\.]+)[\\s,]*', 'i');
  list = list.trim();
  var v = exp.exec(list);
  while (v !== null) {
    var point = v[0];
    var next = exp.lastIndex + point.length;
    point = { x: v[1], y: v[2] };
    points.push(point);
    list = list.slice(next, list.length);
    v = exp.exec(list);
  }
  return points;
};

sax$3.SAXParser.prototype.svgPolyline = function (element) {
  var obj = { type: 'polyline' };
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);

  if ('POINTS' in element) {
    obj.points = this.svgListOfPoints(element.POINTS);
  }
  return obj;
};

sax$3.SAXParser.prototype.svgPolygon = function (element) {
  var obj = { type: 'polygon' };
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);

  if ('POINTS' in element) {
    obj.points = this.svgListOfPoints(element.POINTS);
  }
  return obj;
};

sax$3.SAXParser.prototype.svgRect = function (element) {
  var obj = { type: 'rect', x: '0', y: '0', rx: '0', ry: '0', width: '0', height: '0' };

  if ('X' in element) {
    obj.x = element.X;
  }
  if ('Y' in element) {
    obj.y = element.Y;
  }
  if ('RX' in element) {
    obj.rx = element.RX;
    if (!('RY' in element)) {
      obj.ry = obj.rx;
    } // by SVG specification
  }
  if ('RY' in element) {
    obj.ry = element.RY;
    if (!('RX' in element)) {
      obj.rx = obj.ry;
    } // by SVG specification
  }
  if (obj.rx != obj.ry) {
    console.log('Warning: Unsupported RECT with RX and RY radius');
  }
  if ('WIDTH' in element) {
    obj.width = element.WIDTH;
  }
  if ('HEIGHT' in element) {
    obj.height = element.HEIGHT;
  }
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);
  return obj;
};

sax$3.SAXParser.prototype.svgCircle = function (element) {
  var obj = { type: 'circle', x: '0', y: '0', radius: '0' };

  if ('CX' in element) {
    obj.x = element.CX;
  }
  if ('CY' in element) {
    obj.y = element.CY;
  }
  if ('R' in element) {
    obj.radius = element.R;
  }
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);
  return obj;
};

sax$3.SAXParser.prototype.svgGroup = function (element) {
  var obj = { type: 'group' };
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);

  obj.objects = [];
  return obj;
};

//
// Convert the PATH element into object representation
//
sax$3.SAXParser.prototype.svgPath = function (element) {
  var obj = { type: 'path' };
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  // this.svgPresentation(obj,element);

  obj.commands = [];
  if ('D' in element) {
    var co = null; // current command
    var bf = '';

    var i = 0;
    var l = element.D.length;
    while (i < l) {
      var c = element.D[i];
      switch (c) {
        // numbers
        // FIXME support E notation numbers
        case '-':
          if (bf.length > 0) {
            co.p.push(bf);
            bf = '';
          }
          bf += c;
          break;
        case '.':
          if (bf.length > 0) {
            if (bf.indexOf('.') >= 0) {
              co.p.push(bf);
              bf = '';
            }
          }
          bf += c;
          break;
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          bf += c;
          break;
        // commands
        case 'a':
        case 'A':
        case 'c':
        case 'C':
        case 'h':
        case 'H':
        case 'l':
        case 'L':
        case 'v':
        case 'V':
        case 'm':
        case 'M':
        case 'q':
        case 'Q':
        case 's':
        case 'S':
        case 't':
        case 'T':
        case 'z':
        case 'Z':
          if (co !== null) {
            if (bf.length > 0) {
              co.p.push(bf);
              bf = '';
            }
            obj.commands.push(co);
          }
          co = { c: c, p: [] };
          break;
        // white space
        case ',':
        case ' ':
        case '\n':
          if (co !== null) {
            if (bf.length > 0) {
              co.p.push(bf);
              bf = '';
            }
          }
          break;
        default:
          break;
      }
      i++;
    }
    if (i == l && co !== null) {
      if (bf.length > 0) {
        co.p.push(bf);
      }
      obj.commands.push(co);
    }
  }
  return obj;
};

// generate GROUP with attributes from USE element
// - except X,Y,HEIGHT,WIDTH,XLINK:HREF
// - append translate(x,y) if X,Y available
// deep clone the referenced OBJECT and add to group
// - clone using JSON.parse(JSON.stringify(obj))
sax$3.SAXParser.prototype.svgUse = function (element) {
  var obj = { type: 'group' };
  // transforms
  this.svgTransforms(obj, element);
  // core attributes
  this.svgCore(obj, element);
  // presentation attributes
  this.svgPresentation(obj, element);

  if ('X' in element && 'Y' in element) {
    if (!('transforms' in obj)) {
      obj.transforms = [];
    }
    var o = { translate: [element.X, element.Y] };
    obj.transforms.push(o);
  }

  obj.objects = [];
  if ('XLINK:HREF' in element) {
    // lookup the named object
    var ref = element['XLINK:HREF'];
    if (ref[0] == '#') {
      ref = ref.slice(1, ref.length);
    }
    if (this.svgObjects[ref] !== undefined) {
      ref = this.svgObjects[ref];
      ref = JSON.parse(JSON.stringify(ref));
      obj.objects.push(ref);
    }
  }
  return obj;
};

// processing controls
sax$3.SAXParser.prototype.svgObjects = []; // named objects
sax$3.SAXParser.prototype.svgGroups = []; // groups of objects
sax$3.SAXParser.prototype.svgInDefs = false; // svg DEFS element in process
sax$3.SAXParser.prototype.svgObj = null; // svg in object form
sax$3.SAXParser.prototype.svgUnitsPmm = [1, 1];
sax$3.SAXParser.prototype.svgUnitsPer = 0;

sax$3.SAXParser.prototype.reflect = function (x, y, px, py) {
  var ox = x - px;
  var oy = y - py;
  if (x == px && y == px) {
    return [x, y];
  }
  if (x == px) {
    return [x, py + -oy];
  }
  if (y == py) {
    return [px + -ox, y];
  }
  return [px + -ox, py + -oy];
};

// Return the value for the given attribute from the group hiearchy
sax$3.SAXParser.prototype.groupValue = function (name) {
  var this$1 = this;

  var i = this.svgGroups.length;
  while (i > 0) {
    var g = this$1.svgGroups[i - 1];
    if (name in g) {
      return g[name];
    }
    i--;
  }
  return null;
};

sax$3.SAXParser.prototype.codify = function (group) {
  var this$1 = this;

  var level = this.svgGroups.length;
  // add this group to the heiarchy
  this.svgGroups.push(group);
  // create an indent for the generated code
  var indent = '  ';
  var i = level;
  while (i > 0) {
    indent += '  ';
    i--;
  }
  // pre-code
  var code = '';
  if (level == 0) {
    code += 'function main(params) {\n';
  }
  var ln = 'cag' + level;
  code += indent + 'var ' + ln + ' = new CAG();\n';
  // generate code for all objects
  for (i = 0; i < group.objects.length; i++) {
    var obj = group.objects[i];
    var on = ln + i;
    switch (obj.type) {
      case 'group':
        code += this$1.codify(obj);
        code += indent + 'var ' + on + ' = cag' + (level + 1) + ';\n';
        break;
      case 'rect':
        var x = this$1.cagLengthX(obj.x);
        var y = 0 - this$1.cagLengthY(obj.y);
        var w = this$1.cagLengthX(obj.width);
        var h = this$1.cagLengthY(obj.height);
        var rx = this$1.cagLengthX(obj.rx);
        var ry = this$1.cagLengthY(obj.ry);
        if (w > 0 && h > 0) {
          x = (x + w / 2).toFixed(4); // position the object via the center
          y = (y - h / 2).toFixed(4); // position the object via the center
          if (rx == 0) {
            code += indent + 'var ' + on + ' = CAG.rectangle({center: [' + x + ',' + y + '], radius: [' + w / 2 + ',' + h / 2 + ']});\n';
          } else {
            code += indent + 'var ' + on + ' = CAG.roundedRectangle({center: [' + x + ',' + y + '], radius: [' + w / 2 + ',' + h / 2 + '], roundradius: ' + rx + '});\n';
          }
        }
        break;
      case 'circle':
        var x = this$1.cagLengthX(obj.x);
        var y = 0 - this$1.cagLengthY(obj.y);
        var r = this$1.cagLengthP(obj.radius);
        if (r > 0) {
          code += indent + 'var ' + on + ' = CAG.circle({center: [' + x + ',' + y + '], radius: ' + r + '});\n';
        }
        break;
      case 'ellipse':
        var rx = this$1.cagLengthX(obj.rx);
        var ry = this$1.cagLengthY(obj.ry);
        var cx = this$1.cagLengthX(obj.cx);
        var cy = 0 - this$1.cagLengthY(obj.cy);
        if (rx > 0 && ry > 0) {
          code += indent + 'var ' + on + ' = CAG.ellipse({center: [' + cx + ',' + cy + '], radius: [' + rx + ',' + ry + ']});\n';
        }
        break;
      case 'line':
        var x1 = this$1.cagLengthX(obj.x1);
        var y1 = 0 - this$1.cagLengthY(obj.y1);
        var x2 = this$1.cagLengthX(obj.x2);
        var y2 = 0 - this$1.cagLengthY(obj.y2);
        var r = cssPxUnit; // default
        if ('strokeWidth' in obj) {
          r = this$1.cagLengthP(obj.strokeWidth) / 2;
        } else {
          var v = this$1.groupValue('strokeWidth');
          if (v !== null) {
            r = this$1.cagLengthP(v) / 2;
          }
        }
        code += indent + 'var ' + on + ' = new CSG.Path2D([[' + x1 + ',' + y1 + '],[' + x2 + ',' + y2 + ']],false);\n';
        code += indent + on + ' = ' + on + '.expandToCAG(' + r + ',CSG.defaultResolution2D);\n';
        break;
      case 'polygon':
        code += indent + 'var ' + on + ' = new CSG.Path2D([\n';
        var j = 0;
        for (j = 0; j < obj.points.length; j++) {
          var p = obj.points[j];
          if ('x' in p && 'y' in p) {
            var x = this$1.cagLengthX(p.x);
            var y = 0 - this$1.cagLengthY(p.y);
            code += indent + '  [' + x + ',' + y + '],\n';
          }
        }
        code += indent + '],true);\n';
        code += indent + on + ' = ' + on + '.innerToCAG();\n';
        break;
      case 'polyline':
        var r = cssPxUnit; // default
        if ('strokeWidth' in obj) {
          r = this$1.cagLengthP(obj.strokeWidth) / 2;
        } else {
          var v = this$1.groupValue('strokeWidth');
          if (v !== null) {
            r = this$1.cagLengthP(v) / 2;
          }
        }
        code += indent + 'var ' + on + ' = new CSG.Path2D([\n';
        var j = 0;
        for (j = 0; j < obj.points.length; j++) {
          var p = obj.points[j];
          if ('x' in p && 'y' in p) {
            var x = this$1.cagLengthX(p.x);
            var y = 0 - this$1.cagLengthY(p.y);
            code += indent + '  [' + x + ',' + y + '],\n';
          }
        }
        code += indent + '],false);\n';
        code += indent + on + ' = ' + on + '.expandToCAG(' + r + ',CSG.defaultResolution2D);\n';
        break;
      case 'path':
        code += indent + 'var ' + on + ' = new CAG();\n';

        var r = cssPxUnit; // default
        if ('strokeWidth' in obj) {
          r = this$1.cagLengthP(obj.strokeWidth) / 2;
        } else {
          var v = this$1.groupValue('strokeWidth');
          if (v !== null) {
            r = this$1.cagLengthP(v) / 2;
          }
        }
        // Note: All values are SVG values
        var sx = 0; // starting position
        var sy = 0;
        var cx = 0; // current position
        var cy = 0;
        var pi = 0; // current path index
        var pn = on + pi; // current path name
        var pc = false; // current path closed
        var bx = 0; // 2nd control point from previous C command
        var by = 0; // 2nd control point from previous C command
        var qx = 0; // 2nd control point from previous Q command
        var qy = 0; // 2nd control point from previous Q command
        var j = 0;
        for (j = 0; j < obj.commands.length; j++) {
          var co = obj.commands[j];
          var pts = co.p;
          // console.log('postion: ['+cx+','+cy+'] before '+co.c);
          switch (co.c) {
            case 'm':
              // relative move to X,Y
              // special case, if at beginning of path then treat like absolute M
              if (j == 0) {
                cx = 0;cy = 0;
              }
              // close the previous path
              if (pi > 0 && pc === false) {
                code += indent + pn + ' = ' + pn + '.expandToCAG(' + r + ',CSG.defaultResolution2D);\n';
              }
              // open a new path
              if (pts.length >= 2) {
                cx = cx + parseFloat(pts.shift());
                cy = cy + parseFloat(pts.shift());
                pi++;
                pn = on + pi;
                pc = false;
                code += indent + 'var ' + pn + ' = new CSG.Path2D([[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']],false);\n';
                sx = cx;sy = cy;
              }
              break;
              break;
            case 'M':
              // absolute move to X,Y
              // close the previous path
              if (pi > 0 && pc === false) {
                code += indent + pn + ' = ' + pn + '.expandToCAG(' + r + ',CSG.defaultResolution2D);\n';
              }
              // open a new path
              if (pts.length >= 2) {
                cx = parseFloat(pts.shift());
                cy = parseFloat(pts.shift());
                pi++;
                pn = on + pi;
                pc = false;
                code += indent + 'var ' + pn + ' = new CSG.Path2D([[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']],false);\n';
                sx = cx;sy = cy;
              }
              break;
            case 'a':
              // relative elliptical arc
              while (pts.length >= 7) {
                var rx = parseFloat(pts.shift());
                var ry = parseFloat(pts.shift());
                var ro = 0 - parseFloat(pts.shift());
                var lf = pts.shift() == '1';
                var sf = pts.shift() == '1';
                cx = cx + parseFloat(pts.shift());
                cy = cy + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendArc([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + '],{xradius: ' + this$1.svg2cagX(rx) + ',yradius: ' + this$1.svg2cagY(ry) + ',xaxisrotation: ' + ro + ',clockwise: ' + sf + ',large: ' + lf + '});\n';
              }
              break;
            case 'A':
              // absolute elliptical arc
              while (pts.length >= 7) {
                var rx = parseFloat(pts.shift());
                var ry = parseFloat(pts.shift());
                var ro = 0 - parseFloat(pts.shift());
                var lf = pts.shift() == '1';
                var sf = pts.shift() == '1';
                cx = parseFloat(pts.shift());
                cy = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendArc([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + '],{xradius: ' + this$1.svg2cagX(rx) + ',yradius: ' + this$1.svg2cagY(ry) + ',xaxisrotation: ' + ro + ',clockwise: ' + sf + ',large: ' + lf + '});\n';
              }
              break;
            case 'c':
              // relative cubic Bézier
              while (pts.length >= 6) {
                var x1 = cx + parseFloat(pts.shift());
                var y1 = cy + parseFloat(pts.shift());
                bx = cx + parseFloat(pts.shift());
                by = cy + parseFloat(pts.shift());
                cx = cx + parseFloat(pts.shift());
                cy = cy + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(x1) + ',' + this$1.svg2cagY(y1) + '],[' + this$1.svg2cagX(bx) + ',' + this$1.svg2cagY(by) + '],[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']]);\n';
                var rf = this$1.reflect(bx, by, cx, cy);
                bx = rf[0];
                by = rf[1];
              }
              break;
            case 'C':
              // absolute cubic Bézier
              while (pts.length >= 6) {
                var x1 = parseFloat(pts.shift());
                var y1 = parseFloat(pts.shift());
                bx = parseFloat(pts.shift());
                by = parseFloat(pts.shift());
                cx = parseFloat(pts.shift());
                cy = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(x1) + ',' + this$1.svg2cagY(y1) + '],[' + this$1.svg2cagX(bx) + ',' + this$1.svg2cagY(by) + '],[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']]);\n';
                var rf = this$1.reflect(bx, by, cx, cy);
                bx = rf[0];
                by = rf[1];
              }
              break;
            case 'q':
              // relative quadratic Bézier
              while (pts.length >= 4) {
                qx = cx + parseFloat(pts.shift());
                qy = cy + parseFloat(pts.shift());
                cx = cx + parseFloat(pts.shift());
                cy = cy + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']]);\n';
                var rf = this$1.reflect(qx, qy, cx, cy);
                qx = rf[0];
                qy = rf[1];
              }
              break;
            case 'Q':
              // absolute quadratic Bézier
              while (pts.length >= 4) {
                qx = parseFloat(pts.shift());
                qy = parseFloat(pts.shift());
                cx = parseFloat(pts.shift());
                cy = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']]);\n';
                var rf = this$1.reflect(qx, qy, cx, cy);
                qx = rf[0];
                qy = rf[1];
              }
              break;
            case 't':
              // relative quadratic Bézier shorthand
              while (pts.length >= 2) {
                cx = cx + parseFloat(pts.shift());
                cy = cy + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + cx + ',' + cy + ']]);\n';
                var rf = this$1.reflect(qx, qy, cx, cy);
                qx = rf[0];
                qy = rf[1];
              }
              break;
            case 'T':
              // absolute quadratic Bézier shorthand
              while (pts.length >= 2) {
                cx = parseFloat(pts.shift());
                cy = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + this$1.svg2cagX(qx) + ',' + this$1.svg2cagY(qy) + '],[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']]);\n';
                var rf = this$1.reflect(qx, qy, cx, cy);
                qx = rf[0];
                qy = rf[1];
              }
              break;
            case 's':
              // relative cubic Bézier shorthand
              while (pts.length >= 4) {
                var x1 = bx; // reflection of 2nd control point from previous C
                var y1 = by; // reflection of 2nd control point from previous C
                bx = cx + parseFloat(pts.shift());
                by = cy + parseFloat(pts.shift());
                cx = cx + parseFloat(pts.shift());
                cy = cy + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(x1) + ',' + this$1.svg2cagY(y1) + '],[' + this$1.svg2cagX(bx) + ',' + this$1.svg2cagY(by) + '],[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']]);\n';
                var rf = this$1.reflect(bx, by, cx, cy);
                bx = rf[0];
                by = rf[1];
              }
              break;
            case 'S':
              // absolute cubic Bézier shorthand
              while (pts.length >= 4) {
                var x1 = bx; // reflection of 2nd control point from previous C
                var y1 = by; // reflection of 2nd control point from previous C
                bx = parseFloat(pts.shift());
                by = parseFloat(pts.shift());
                cx = parseFloat(pts.shift());
                cy = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendBezier([[' + this$1.svg2cagX(x1) + ',' + this$1.svg2cagY(y1) + '],[' + this$1.svg2cagX(bx) + ',' + this$1.svg2cagY(by) + '],[' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']]);\n';
                var rf = this$1.reflect(bx, by, cx, cy);
                bx = rf[0];
                by = rf[1];
              }
              break;
            case 'h':
              // relative Horzontal line to
              while (pts.length >= 1) {
                cx = cx + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendPoint([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']);\n';
              }
              break;
            case 'H':
              // absolute Horzontal line to
              while (pts.length >= 1) {
                cx = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendPoint([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']);\n';
              }
              break;
            case 'l':
              // relative line to
              while (pts.length >= 2) {
                cx = cx + parseFloat(pts.shift());
                cy = cy + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendPoint([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']);\n';
              }
              break;
            case 'L':
              // absolute line to
              while (pts.length >= 2) {
                cx = parseFloat(pts.shift());
                cy = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendPoint([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']);\n';
              }
              break;
            case 'v':
              // relative Vertical line to
              while (pts.length >= 1) {
                cy = cy + parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendPoint([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']);\n';
              }
              break;
            case 'V':
              // absolute Vertical line to
              while (pts.length >= 1) {
                cy = parseFloat(pts.shift());
                code += indent + pn + ' = ' + pn + '.appendPoint([' + this$1.svg2cagX(cx) + ',' + this$1.svg2cagY(cy) + ']);\n';
              }
              break;
            case 'z': // close current line
            case 'Z':
              code += indent + pn + ' = ' + pn + '.close();\n';
              code += indent + pn + ' = ' + pn + '.innerToCAG();\n';
              code += indent + on + ' = ' + on + '.union(' + pn + ');\n';
              cx = sx;cy = sy; // return to the starting point
              pc = true;
              break;
            default:
              console.log('Warning: Unknow PATH command [' + co.c + ']');
              break;
          }
          // console.log('postion: ['+cx+','+cy+'] after '+co.c);
        }
        if (pi > 0) {
          if (pc === false) {
            code += indent + pn + ' = ' + pn + '.expandToCAG(' + r + ',CSG.defaultResolution2D);\n';
            code += indent + on + ' = ' + on + '.union(' + pn + ');\n';
          }
        }
        break;
      default:
        break;
    }
    if ('fill' in obj) {
      // FIXME when CAG supports color
      //  code += indent+on+' = '+on+'.setColor(['+obj.fill[0]+','+obj.fill[1]+','+obj.fill[2]+']);\n';
    }
    if ('transforms' in obj) {
      // NOTE: SVG specifications require that transforms are applied in the order given.
      //       But these are applied in the order as required by CSG/CAG
      var tr = null;
      var ts = null;
      var tt = null;

      var j = 0;
      for (j = 0; j < obj.transforms.length; j++) {
        var t = obj.transforms[j];
        if ('rotate' in t) {
          tr = t;
        }
        if ('scale' in t) {
          ts = t;
        }
        if ('translate' in t) {
          tt = t;
        }
      }
      if (ts !== null) {
        var x = ts.scale[0];
        var y = ts.scale[1];
        code += indent + on + ' = ' + on + '.scale([' + x + ',' + y + ']);\n';
      }
      if (tr !== null) {
        var z = 0 - tr.rotate;
        code += indent + on + ' = ' + on + '.rotateZ(' + z + ');\n';
      }
      if (tt !== null) {
        var x = this$1.cagLengthX(tt.translate[0]);
        var y = 0 - this$1.cagLengthY(tt.translate[1]);
        code += indent + on + ' = ' + on + '.translate([' + x + ',' + y + ']);\n';
      }
    }
    code += indent + ln + ' = ' + ln + '.union(' + on + ');\n';
  }
  // post-code
  if (level == 0) {
    code += indent + 'return ' + ln + ';\n';
    code += '}\n';
  }
  // remove this group from the hiearchy
  this.svgGroups.pop();

  return code;
};

function createSvgParser(src, pxPmm) {
  // create a parser for the XML
  var parser = sax$3.parser(false, { trim: true, lowercase: false, position: true });
  if (pxPmm !== undefined) {
    if (pxPmm > parser.pxPmm) {
      parser.pxPmm = pxPmm;
    }
  }
  // extend the parser with functions
  parser.onerror = function (e) {
    console.log('error: line ' + e.line + ', column ' + e.column + ', bad character [' + e.c + ']');
  };

  // parser.ontext = function (t) {
  // };

  parser.onopentag = function (node) {
    // console.log('opentag: '+node.name+' at line '+this.line+' position '+this.column);
    // for (x in node.attributes) {
    //  console.log('    '+x+'='+node.attributes[x]);
    // }
    var obj = null;
    switch (node.name) {
      case 'SVG':
        obj = this.svgSvg(node.attributes);
        break;
      case 'G':
        obj = this.svgGroup(node.attributes);
        break;
      case 'RECT':
        obj = this.svgRect(node.attributes);
        break;
      case 'CIRCLE':
        obj = this.svgCircle(node.attributes);
        break;
      case 'ELLIPSE':
        obj = this.svgEllipse(node.attributes);
        break;
      case 'LINE':
        obj = this.svgLine(node.attributes);
        break;
      case 'POLYLINE':
        obj = this.svgPolyline(node.attributes);
        break;
      case 'POLYGON':
        obj = this.svgPolygon(node.attributes);
        break;
      // case 'SYMBOL':
      // this is just like an embedded SVG but does NOT render directly, only named
      // this requires another set of control objects
      // only add to named objects for later USE
      //  break;
      case 'PATH':
        obj = this.svgPath(node.attributes);
        break;
      case 'USE':
        obj = this.svgUse(node.attributes);
        break;
      case 'DEFS':
        this.svgInDefs = true;
        break;
      case 'DESC':
      case 'TITLE':
      case 'STYLE':
        // ignored by design
        break;
      default:
        console.log('Warning: Unsupported SVG element: ' + node.name);
        break;
    }

    if (obj !== null) {
      // add to named objects if necessary
      if ('id' in obj) {
        this.svgObjects[obj.id] = obj;
        // console.log('saved object ['+obj.id+','+obj.type+']');
      }
      if (obj.type == 'svg') {
        // initial SVG (group)
        this.svgGroups.push(obj);
        this.svgUnitsPmm = obj.unitsPmm;
        this.svgUnitsX = obj.viewW;
        this.svgUnitsY = obj.viewH;
        this.svgUnitsV = obj.viewP;
      } else {
        // add the object to the active group if necessary
        if (this.svgGroups.length > 0 && this.svgInDefs == false) {
          var group = this.svgGroups.pop();
          if ('objects' in group) {
            // console.log('push object ['+obj.type+']');
            // console.log(JSON.stringify(obj));
            // TBD apply presentation attributes from the group
            group.objects.push(obj);
          }
          this.svgGroups.push(group);
        }
        if (obj.type == 'group') {
          // add GROUPs to the stack
          this.svgGroups.push(obj);
        }
      }
    }
  };

  parser.onclosetag = function (node) {
    // console.log('closetag: '+node);
    var obj = null;
    switch (node) {
      case 'SVG':
        obj = this.svgGroups.pop();
        // console.log("groups: "+groups.length);
        break;
      case 'DEFS':
        this.svgInDefs = false;
        break;
      case 'USE':
        obj = this.svgGroups.pop();
        // console.log("groups: "+groups.length);
        break;
      case 'G':
        obj = this.svgGroups.pop();
        // console.log("groups: "+groups.length);
        break;
      default:
        break;
    }
    // check for completeness
    if (this.svgGroups.length === 0) {
      this.svgObj = obj;
    }
  };

  // parser.onattribute = function (attr) {
  // };

  parser.onend = function () {
    //  console.log('SVG parsing completed');
  };
  // start the parser
  parser.write(src).close();

  return parser;
}

//
// Parse the given SVG source and return a JSCAD script
//
// fn (optional) original filename of SVG source
// options (optional) anonymous object with:
//   pxPmm: pixels per milimeter for calcuations
//
function parseSVG(src, fn, options) {
  var fn = fn || 'svg';
  var defaults = { pxPmm: undefined, version: '0.0.0' };
  options = Object.assign({}, defaults, options);
  var version = options.version;
  var pxPmm = options.pxPmm;

  // parse the SVG source
  var parser = createSvgParser(src, pxPmm);
  // convert the internal objects to JSCAD code
  var code = '';
  code += '//\n';
  code += '// producer: OpenJSCAD.org ' + version + ' SVG Importer\n';
  code += '// date: ' + new Date() + '\n';
  code += '// source: ' + fn + '\n';
  code += '//\n';
  if (parser.svgObj !== null) {
    // console.log(JSON.stringify(parser.svgObj));
    code += parser.codify(parser.svgObj);
  } else {
    console.log('Warning: SVG parsing failed');
  }
  return code;
}

exports.makeBlob = makeBlob;
exports.revokeBlobUrl = revokeBlobUrl;
exports.CAGToDxf = CAGToDxf;
exports.CAGToJson = CAGToJson;
exports.CAGToSvg = CAGToSvg;
exports.CSGToAMF = CSGToAMF;
exports.CSGToJson = CSGToJson;
exports.CSGToStla = CSGToStla;
exports.CSGToStlb = CSGToStlb;
exports.CSGToX3D = CSGToX3D;
exports.parseAMF = parseAMF;
exports.parseGCode = parseGCode;
exports.parseJSON = parseJSON;
exports.parseOBJ = parseOBJ;
exports.parseSTL = parseSTL;
exports.parseSVG = parseSVG;


}).call(this,require("buffer").Buffer)
},{"@jscad/csg":1,"buffer":8,"sax":30}],3:[function(require,module,exports){
'use strict';

var _jscad_csg = require('@jscad/csg');

// -- 2D primitives (OpenSCAD like notion)

function square () {
  var v = [1, 1];
  var off;
  var a = arguments;
  var p = a[0];

  if (p && Number.isFinite(p)) { v = [p, p]; }
  if (p && p.length) { v = a[0], p = a[1]; }
  if (p && p.size && p.size.length) { v = p.size; }

  off = [v[0] / 2, v[1] / 2];
  if (p && p.center === true) { off = [0, 0]; }

  var o = _jscad_csg.CAG.rectangle({center: off, radius: [v[0] / 2, v[1] / 2]});

  return o
}

function circle () {
  var r = 1;
  var off;
  var fn = 32;
  var a = arguments;
  var p = a[0];
  if (p && p.r) { r = p.r; }
  if (p && p.fn) { fn = p.fn; }
  if (p && !p.r && !p.fn && !p.center) { r = p; }
  off = [r, r];
  if (p && p.center === true) { off = [0, 0]; }
  var o = _jscad_csg.CAG.circle({center: off, radius: r, resolution: fn});
  return o
}

function polygon (p) { // array of po(ints) and pa(ths)
  var points = [ ];
  if (p.paths && p.paths.length && p.paths[0].length) { // pa(th): [[0,1,2],[2,3,1]] (two paths)
    for (var j = 0; j < p.paths.length; j++) {
      for (var i = 0; i < p.paths[j].length; i++) {
        points[i] = p.points[p.paths[j][i]];
      }
    }
  } else if (p.paths && p.paths.length) { // pa(th): [0,1,2,3,4] (single path)
    for (var i = 0; i < p.paths.length; i++) {
      points[i] = p.points[p.paths[i]];
    }
  } else { // pa(th) = po(ints)
    if (p.length) {
      points = p;
    } else {
      points = p.points;
    }
  }
  return _jscad_csg.CAG.fromPoints(points)
}

function triangle () { // -- new addition
  var a = arguments;
  if (a[0] && a[0].length) { a = a[0]; }
  var o = _jscad_csg.CAG.fromPoints(a);
  return o
}


var primitives2d = Object.freeze({
	square: square,
	circle: circle,
	polygon: polygon,
	triangle: triangle
});

// -- 2D to 3D primitives (OpenSCAD like notion)

function linear_extrude (p, s) {
  // console.log("linear_extrude() not yet implemented")
  // return
  var h = 1;
  var off = 0;
  var twist = 0;
  var slices = 10;
  /* convexity = 10,*/

  if (p.height) { h = p.height; }
  // if(p.convexity) convexity = p.convexity      // abandoned
  if (p.twist) { twist = p.twist; }
  if (p.slices) { slices = p.slices; }
  var o = s.extrude({offset: [0, 0, h], twistangle: twist, twiststeps: slices});
  if (p.center === true) {
    var b = [ ];
    b = o.getBounds(); // b[0] = min, b[1] = max
    off = b[1].plus(b[0]);
    off = off.times(-0.5);
    o = o.translate(off);
  }
  return o
}

function rotate_extrude (p, o) {
  var fn = 32;
  if (arguments.length < 2) {
    o = p; // no switches, just an object
  } else if (p !== undefined) {
    fn = p.fn;
  }
  if (fn < 3) { fn = 3; }
  var ps = [];
  for (var i = 0; i < fn; i++) {
    // o.{x,y} -> rotate([0,0,i:0..360], obj->{o.x,0,o.y})
    for (var j = 0; j < o.sides.length; j++) {
      // has o.sides[j].vertex{0,1}.pos (only x,y)
      var p = [];
      var m;

      m = new _jscad_csg.CSG.Matrix4x4.rotationZ(i / fn * 360);
      p[0] = new _jscad_csg.CSG.Vector3D(o.sides[j].vertex0.pos.x, 0, o.sides[j].vertex0.pos.y);
      p[0] = m.rightMultiply1x3Vector(p[0]);

      p[1] = new _jscad_csg.CSG.Vector3D(o.sides[j].vertex1.pos.x, 0, o.sides[j].vertex1.pos.y);
      p[1] = m.rightMultiply1x3Vector(p[1]);

      m = new _jscad_csg.CSG.Matrix4x4.rotationZ((i + 1) / fn * 360);
      p[2] = new _jscad_csg.CSG.Vector3D(o.sides[j].vertex1.pos.x, 0, o.sides[j].vertex1.pos.y);
      p[2] = m.rightMultiply1x3Vector(p[2]);

      p[3] = new _jscad_csg.CSG.Vector3D(o.sides[j].vertex0.pos.x, 0, o.sides[j].vertex0.pos.y);
      p[3] = m.rightMultiply1x3Vector(p[3]);

      var p1 = new _jscad_csg.CSG.Polygon([
        new _jscad_csg.CSG.Vertex(p[0]),
        new _jscad_csg.CSG.Vertex(p[1]),
        new _jscad_csg.CSG.Vertex(p[2]),
        new _jscad_csg.CSG.Vertex(p[3]) ]);
      // var p2 = new CSG.Polygon([
      //   new CSG.Vertex(p[0]),
      //   new CSG.Vertex(p[2]),
      //   new CSG.Vertex(p[3]),
      // ])
      ps.push(p1);
    // ps.push(p2)
    // echo("i="+i,i/fn*360,"j="+j)
    }
  }
  return _jscad_csg.CSG.fromPolygons(ps)
}

function rectangular_extrude (pa, p) {
  var w = 1;
  var h = 1;
  var fn = 8;
  var closed = false;
  var round = true;
  if (p) {
    if (p.w) { w = p.w; }
    if (p.h) { h = p.h; }
    if (p.fn) { fn = p.fn; }
    if (p.closed !== undefined) { closed = p.closed; }
    if (p.round !== undefined) { round = p.round; }
  }
  return new _jscad_csg.CSG.Path2D(pa, closed).rectangularExtrude(w, h, fn, round)
}


var extrusions = Object.freeze({
	linear_extrude: linear_extrude,
	rotate_extrude: rotate_extrude,
	rectangular_extrude: rectangular_extrude
});

// -- 3D primitives (OpenSCAD like notion)
function cube (p) {
  var s = 1, v = null, off = [0, 0, 0], round = false, r = 0, fn = 8;
  if (p && p.length) { v = p; }
  if (p && p.size && p.size.length) { v = p.size; } // { size: [1,2,3] }
  if (p && p.size && !p.size.length) { s = p.size; } // { size: 1 }
  // if(p&&!p.size&&!p.length&&p.center===undefined&&!p.round&&!p.radius) s = p      // (2)
  if (p && (typeof p != 'object')) { s = p; }// (2)
  if (p && p.round == true) { round = true, r = v && v.length ? (v[0] + v[1] + v[2]) / 30 : s / 10;}
  if (p && p.radius) { round = true, r = p.radius; }
  if (p && p.fn) { fn = p.fn; } // applies in case of round: true

  var x = s, y = s, z = s;
  if (v && v.length) {
    x = v[0], y = v[1], z = v[2];
  }
  off = [x / 2, y / 2, z / 2]; // center: false default
  var o = round ?
    _jscad_csg.CSG.roundedCube({radius: [x / 2, y / 2, z / 2], roundradius: r, resolution: fn}) :
    _jscad_csg.CSG.cube({radius: [x / 2, y / 2, z / 2]});
  if (p && p.center && p.center.length) {
    off = [p.center[0] ? 0 : x / 2, p.center[1] ? 0 : y / 2, p.center[2] ? 0 : z / 2];
  } else if (p && p.center == true) {
    off = [0, 0, 0];
  } else if (p && p.center == false) {
    off = [x / 2, y / 2, z / 2];
  }
  if (off[0] || off[1] || off[2]) { o = o.translate(off); }
  // if(v&&v.length) o = o.scale(v)      // we don't scale afterwards, we already created box with the correct size
  return o
}

function sphere (p) {
  var r = 1;
  var fn = 32;
  var off = [0, 0, 0];
  var type = 'normal';

  // var zoff = 0 // sphere() in openscad has no center:true|false
  if (p && p.r) { r = p.r; }
  if (p && p.fn) { fn = p.fn; }
  if (p && p.type) { type = p.type; }
  // if(p&&!p.r&&!p.fn&&!p.type) r = p
  if (p && (typeof p != 'object')) { r = p; }
  off = [0, 0, 0]; // center: false (default)

  var o;
  if (type == 'geodesic')
    { o = geodesicSphere(p); }
  else
    { o = _jscad_csg.CSG.sphere({radius: r,resolution: fn}); }

  if (p && p.center && p.center.length) { // preparing individual x,y,z center
    off = [p.center[0] ? 0 : r, p.center[1] ? 0 : r, p.center[2] ? 0 : r];
  } else if (p && p.center == true) {
    off = [0, 0, 0];
  } else if (p && p.center == false) {
    off = [r, r, r];
  }
  if (off[0] || off[1] || off[2]) { o = o.translate(off); }
  return o
}

function geodesicSphere (p) {
  var r = 1, fn = 5;

  var ci = [ // hard-coded data of icosahedron (20 faces, all triangles)
    [0.850651, 0.000000, -0.525731],
    [0.850651, -0.000000, 0.525731],
    [-0.850651, -0.000000, 0.525731],
    [-0.850651, 0.000000, -0.525731],
    [0.000000, -0.525731, 0.850651],
    [0.000000, 0.525731, 0.850651],
    [0.000000, 0.525731, -0.850651],
    [0.000000, -0.525731, -0.850651],
    [-0.525731, -0.850651, -0.000000],
    [0.525731, -0.850651, -0.000000],
    [0.525731, 0.850651, 0.000000],
    [-0.525731, 0.850651, 0.000000]];

  var ti = [ [0, 9, 1], [1, 10, 0], [6, 7, 0], [10, 6, 0], [7, 9, 0], [5, 1, 4], [4, 1, 9], [5, 10, 1], [2, 8, 3], [3, 11, 2], [2, 5, 4],
    [4, 8, 2], [2, 11, 5], [3, 7, 6], [6, 11, 3], [8, 7, 3], [9, 8, 4], [11, 10, 5], [10, 11, 6], [8, 9, 7]];

  var geodesicSubDivide = function (p, fn, off) {
    var p1 = p[0], p2 = p[1], p3 = p[2];
    var n = off;
    var c = [];
    var f = [];

    //           p3
    //           /\
    //          /__\     fn = 3
    //      i  /\  /\
    //        /__\/__\       total triangles = 9 (fn*fn)
    //       /\  /\  /\
    //     0/__\/__\/__\
    //    p1 0   j      p2

    for (var i = 0; i < fn; i++) {
      for (var j = 0; j < fn - i; j++) {
        var t0 = i / fn;
        var t1 = (i + 1) / fn;
        var s0 = j / (fn - i);
        var s1 = (j + 1) / (fn - i);
        var s2 = fn - i - 1 ? j / (fn - i - 1) : 1;
        var q = [];

        q[0] = mix3(mix3(p1, p2, s0), p3, t0);
        q[1] = mix3(mix3(p1, p2, s1), p3, t0);
        q[2] = mix3(mix3(p1, p2, s2), p3, t1);

        // -- normalize
        for (var k = 0; k < 3; k++) {
          var r = Math.sqrt(q[k][0] * q[k][0] + q[k][1] * q[k][1] + q[k][2] * q[k][2]);
          for (var l = 0; l < 3; l++) {
            q[k][l] /= r;
          }
        }
        c.push(q[0], q[1], q[2]);
        f.push([n, n + 1, n + 2]); n += 3;

        if (j < fn - i - 1) {
          var s3 = fn - i - 1 ? (j + 1) / (fn - i - 1) : 1;
          q[0] = mix3(mix3(p1, p2, s1), p3, t0);
          q[1] = mix3(mix3(p1, p2, s3), p3, t1);
          q[2] = mix3(mix3(p1, p2, s2), p3, t1);

          // -- normalize
          for (var k = 0; k < 3; k++) {
            var r = Math.sqrt(q[k][0] * q[k][0] + q[k][1] * q[k][1] + q[k][2] * q[k][2]);
            for (var l = 0; l < 3; l++) {
              q[k][l] /= r;
            }
          }
          c.push(q[0], q[1], q[2]);
          f.push([n, n + 1, n + 2]); n += 3;
        }
      }
    }
    return { points: c, triangles: f, off: n }
  };

  var mix3 = function (a, b, f) {
    var _f = 1 - f;
    var c = [];
    for (var i = 0; i < 3; i++) {
      c[i] = a[i] * _f + b[i] * f;
    }
    return c
  };

  if (p) {
    if (p.fn) { fn = Math.floor(p.fn / 6); }
    if (p.r) { r = p.r; }
  }

  if (fn <= 0) { fn = 1; }

  var q = [];
  var c = [], f = [];
  var off = 0;

  for (var i = 0; i < ti.length; i++) {
    var g = geodesicSubDivide([ ci[ti[i][0]], ci[ti[i][1]], ci[ti[i][2]]], fn, off);
    c = c.concat(g.points);
    f = f.concat(g.triangles);
    off = g.off;
  }
  return polyhedron({points: c, triangles: f}).scale(r)
}

function cylinder (p) {
  var r1 = 1, r2 = 1, h = 1, fn = 32, round = false;
  var a = arguments;
  var off = [0, 0, 0];
  if (p && p.d) {
    r1 = r2 = p.d / 2;
  }
  if (p && p.r) {
    r1 = p.r;
    r2 = p.r;
  }
  if (p && p.h) {
    h = p.h;
  }
  if (p && (p.r1 || p.r2)) {
    r1 = p.r1;
    r2 = p.r2;
    if (p.h) { h = p.h; }
  }
  if (p && (p.d1 || p.d2)) {
    r1 = p.d1 / 2;
    r2 = p.d2 / 2;
  }

  if (a && a[0] && a[0].length) {
    a = a[0];
    r1 = a[0];
    r2 = a[1];
    h = a[2];
    if (a.length === 4) { fn = a[3]; }
  }
  if (p && p.fn) { fn = p.fn; }
  // if(p&&p.center==true) zoff = -h/2
  if (p && p.round === true) { round = true; }
  var o;
  if (p && (p.start && p.end)) {
    o = round ?
      _jscad_csg.CSG.roundedCylinder({start: p.start, end: p.end, radiusStart: r1, radiusEnd: r2, resolution: fn}) :
      _jscad_csg.CSG.cylinder({start: p.start, end: p.end, radiusStart: r1, radiusEnd: r2, resolution: fn});
  } else {
    o = round ?
      _jscad_csg.CSG.roundedCylinder({start: [0, 0, 0], end: [0, 0, h], radiusStart: r1, radiusEnd: r2, resolution: fn}) :
      _jscad_csg.CSG.cylinder({start: [0, 0, 0], end: [0, 0, h], radiusStart: r1, radiusEnd: r2, resolution: fn});
    var r = r1 > r2 ? r1 : r2;
    if (p && p.center && p.center.length) { // preparing individual x,y,z center
      off = [p.center[0] ? 0 : r, p.center[1] ? 0 : r, p.center[2] ? -h / 2 : 0];
    } else if (p && p.center === true) {
      off = [0, 0, -h / 2];
    } else if (p && p.center === false) {
      off = [0, 0, 0];
    }
    if (off[0] || off[1] || off[2]) { o = o.translate(off); }
  }
  return o
}

function torus (p) {
  var ri = 1, ro = 4, fni = 16, fno = 32, roti = 0;
  if (p) {
    if (p.ri) { ri = p.ri; }
    if (p.fni) { fni = p.fni; }
    if (p.roti) { roti = p.roti; }
    if (p.ro) { ro = p.ro; }
    if (p.fno) { fno = p.fno; }
  }
  if (fni < 3) { fni = 3; }
  if (fno < 3) { fno = 3; }
  var c = circle({r: ri, fn: fni, center: true});
  if (roti) { c = c.rotateZ(roti); }
  return rotate_extrude({fn: fno}, c.translate([ro, 0, 0]))
}

function polyhedron (p) {
  var pgs = [];
  var ref = p.triangles || p.polygons;
  var colors = p.colors || null;

  for (var i = 0; i < ref.length; i++) {
    var pp = [];
    for (var j = 0; j < ref[i].length; j++) {
      pp[j] = p.points[ref[i][j]];
    }

    var v = [];
    for (j = ref[i].length - 1; j >= 0; j--) { // --- we reverse order for examples of OpenSCAD work
      v.push(new _jscad_csg.CSG.Vertex(new _jscad_csg.CSG.Vector3D(pp[j][0], pp[j][1], pp[j][2])));
    }
    var s = _jscad_csg.CSG.Polygon.defaultShared;
    if (colors && colors[i]) {
      s = _jscad_csg.CSG.Polygon.Shared.fromColor(colors[i]);
    }
    pgs.push(new _jscad_csg.CSG.Polygon(v, s));
  }
  var r = _jscad_csg.CSG.fromPolygons(pgs);
  return r
}


var primitives3d = Object.freeze({
	cube: cube,
	sphere: sphere,
	geodesicSphere: geodesicSphere,
	cylinder: cylinder,
	torus: torus,
	polyhedron: polyhedron
});

// -- 3D operations (OpenSCAD like notion)
function union () {
  var o,i = 0,a = arguments;
  if (a[0].length) { a = a[0]; }

  o = a[i++];
  for (; i < a.length; i++) {
    var obj = a[i];

    // for now disabled, later perhaps allow mixed union of CAG/CSG
    if (0 && (typeof (a[i]) == 'object') && (a[i] instanceof _jscad_csg.CAG)) {
      obj = a[i].extrude({offset: [0, 0, 0.1]}); // -- convert a 2D shape to a thin solid:
    }
    o = o.union(obj);
  }
  return o
}

function difference () {
  var o,i = 0,a = arguments;
  if (a[0].length) { a = a[0]; }
  for (o = a[i++]; i < a.length; i++) {
    if (a[i] instanceof _jscad_csg.CAG) {
      o = o.subtract(a[i]);
    } else {
      o = o.subtract(a[i].setColor(1, 1, 0)); // -- color the cuts
    }
  }
  return o
}

function intersection () {
  var o,i = 0,a = arguments;
  if (a[0].length) { a = a[0]; }
  for (o = a[i++]; i < a.length; i++) {
    if (a[i] instanceof _jscad_csg.CAG) {
      o = o.intersect(a[i]);
    } else {
      o = o.intersect(a[i].setColor(1, 1, 0)); // -- color the cuts
    }
  }
  return o
}


var booleanOps = Object.freeze({
	union: union,
	difference: difference,
	intersection: intersection
});

// -- 3D transformations (OpenSCAD like notion)


function translate() {      // v, obj or array
   var a = arguments, v = a[0], o, i = 1;
   if(a[1].length) { a = a[1]; i = 0; }
   for(o=a[i++]; i<a.length; i++) {
      o = o.union(a[i]);
   }
   return o.translate(v);
}

function center() { // v, obj or array
   var a = arguments, v = a[0], o, i = 1;
   if(a[1].length) { a = a[1]; i = 0; }
   for(o=a[i++]; i<a.length; i++) {
      o = o.union(a[i]);
   }
   return o.center(v);
}

function scale() {         // v, obj or array
   var a = arguments, v = a[0], o, i = 1;
   if(a[1].length) { a = a[1]; i = 0; }
   for(o=a[i++]; i<a.length; i++) {
      o = o.union(a[i]);
   }
   return o.scale(v);
}

function rotate() {
   var o,i,v, r = 1, a = arguments;
   if(!a[0].length) {        // rotate(r,[x,y,z],o)
      r = a[0];
      v = a[1];
      i = 2;
      if(a[2].length) { a = a[2]; i = 0; }
   } else {                   // rotate([x,y,z],o)
      v = a[0];
      i = 1;
      if(a[1].length) { a = a[1]; i = 0; }
   }
   for(o=a[i++]; i<a.length; i++) {
      o = o.union(a[i]);
   }
   if(r!=1) {
      return o.rotateX(v[0]*r).rotateY(v[1]*r).rotateZ(v[2]*r);
   } else {
      return o.rotateX(v[0]).rotateY(v[1]).rotateZ(v[2]);
   }
}

function mirror(v,o) {
   var a = Array.prototype.slice.call(arguments, 1, arguments.length),
       o = a[0];

   for(var i=1; i<a.length; i++) {
      o = o.union(a[i]);
   }
   var plane = new _jscad_csg.CSG.Plane(new _jscad_csg.CSG.Vector3D(v[0], v[1], v[2]).unit(), 0);
   return o.mirrored(plane);
}

function expand(r,n,o) {
   return o.expand(r,n);
}

function contract(r,n,o) {
   return o.contract(r,n);
}

function multmatrix(mat, obj) {
   console.log("multmatrix() not yet implemented");
}

function minkowski() {
   console.log("minkowski() not yet implemented");
}

function hull() {
   var pts = [];

   var a = arguments;
   if(a[0].length) { a = a[0]; }
   var done = [];

   for(var i=0; i<a.length; i++) {              // extract all points of the CAG in the argument list
      var cag = a[i];
      if(!(cag instanceof _jscad_csg.CAG)) {
         throw("ERROR: hull() accepts only 2D forms / CAG");
         return;
      }
      for(var j=0; j<cag.sides.length; j++) {
         var x = cag.sides[j].vertex0.pos.x;
         var y = cag.sides[j].vertex0.pos.y;
         if(done[''+x+','+y])  // avoid some coord to appear multiple times
            { continue; }
         pts.push({ x:x, y:y });
         done[''+x+','+y]++;
         //echo(x,y);
      }
   }
   //echo(pts.length+" points in",pts);

   // from http://www.psychedelicdevelopment.com/grahamscan/
   //    see also at https://github.com/bkiers/GrahamScan/blob/master/src/main/cg/GrahamScan.java
   var ConvexHullPoint = function(i, a, d) {

      this.index = i;
      this.angle = a;
      this.distance = d;

      this.compare = function(p) {
         if (this.angle<p.angle)
            { return -1; }
         else if (this.angle>p.angle)
            { return 1; }
         else {
            if (this.distance<p.distance)
               { return -1; }
            else if (this.distance>p.distance)
               { return 1; }
         }
         return 0;
      };
   };

   var ConvexHull = function() {
      this.points = null;
      this.indices = null;

      this.getIndices = function() {
         return this.indices;
      };

      this.clear = function() {
         this.indices = null;
         this.points = null;
      };

      this.ccw = function(p1, p2, p3) {
         var ccw = (this.points[p2].x - this.points[p1].x)*(this.points[p3].y - this.points[p1].y) -
                   (this.points[p2].y - this.points[p1].y)*(this.points[p3].x - this.points[p1].x);
         if(ccw<1e-5)      // we need this, otherwise sorting never ends, see https://github.com/Spiritdude/OpenJSCAD.org/issues/18
            { return 0 }
         return ccw;
      };

      this.angle = function(o, a) {
         //return Math.atan((this.points[a].y-this.points[o].y) / (this.points[a].x - this.points[o].x));
         return Math.atan2((this.points[a].y-this.points[o].y), (this.points[a].x - this.points[o].x));
      };

      this.distance = function(a, b) {
         return ((this.points[b].x-this.points[a].x)*(this.points[b].x-this.points[a].x)+
                 (this.points[b].y-this.points[a].y)*(this.points[b].y-this.points[a].y));
      };

      this.compute = function(_points) {
         var this$1 = this;

         this.indices=null;
         if (_points.length<3)
            { return; }
         this.points=_points;

         // Find the lowest point
         var min = 0;
         for(var i = 1; i < this.points.length; i++) {
            if(this$1.points[i].y==this$1.points[min].y) {
               if(this$1.points[i].x<this$1.points[min].x)
                  { min = i; }
            }
            else if(this$1.points[i].y<this$1.points[min].y)
               { min = i; }
         }

         // Calculate angle and distance from base
         var al = new Array();
         var ang = 0.0;
         var dist = 0.0;
         for (i = 0; i<this.points.length; i++) {
            if (i==min)
               { continue; }
            ang = this$1.angle(min, i);
            if (ang<0)
               { ang += Math.PI; }
            dist = this$1.distance(min, i);
            al.push(new ConvexHullPoint(i, ang, dist));
         }

         al.sort(function (a, b) { return a.compare(b); });

         // Create stack
         var stack = new Array(this.points.length+1);
         var j = 2;
         for(i = 0; i<this.points.length; i++) {
            if(i==min)
               { continue; }
            stack[j] = al[j-2].index;
            j++;
         }
         stack[0] = stack[this.points.length];
         stack[1] = min;

         var tmp;
         var M = 2;
         for(i = 3; i<=this.points.length; i++) {
            while(this.ccw(stack[M-1], stack[M], stack[i]) <= 0)
               { M--; }
            M++;
            tmp = stack[i];
            stack[i] = stack[M];
            stack[M] = tmp;
         }

         this.indices = new Array(M);
         for (i = 0; i<M; i++) {
            this$1.indices[i] = stack[i+1];
         }
      };
   };

   var hull = new ConvexHull();

   hull.compute(pts);
   var indices = hull.getIndices();

   if(indices&&indices.length>0) {
      var ch = [];
      for(var i=0; i<indices.length; i++) {
         ch.push(pts[indices[i]]);
         //echo(pts[indices[i]]);
      }
      //echo(ch.length+" points out",ch);
      return _jscad_csg.CAG.fromPoints(ch);
      //return CAG.fromPointsNoCheck(ch);
   }
}

// "Whosa whatsis" suggested "Chain Hull" as described at https://plus.google.com/u/0/105535247347788377245/posts/aZGXKFX1ACN
// essentially hull A+B, B+C, C+D and then union those

function chain_hull() {
   var a = arguments;
   var j = 0, closed = false;

   if(a[j].closed!==undefined)
      { closed = a[j++].closed; }

   if(a[j].length)
      { a = a[j]; }

   var h = []; var n = a.length-(closed?0:1);
   for(var i=0; i<n; i++) {
      h.push(hull(a[i],a[(i+1)%a.length]));
   }
   return union(h);
}


var transformations = Object.freeze({
	translate: translate,
	center: center,
	scale: scale,
	rotate: rotate,
	mirror: mirror,
	expand: expand,
	contract: contract,
	multmatrix: multmatrix,
	minkowski: minkowski,
	hull: hull,
	chain_hull: chain_hull
});

// color table from http://www.w3.org/TR/css3-color/
var cssColors = {
// basic color keywords
  'black': [ 0 / 255, 0 / 255, 0 / 255 ],
  'silver': [ 192 / 255, 192 / 255, 192 / 255 ],
  'gray': [ 128 / 255, 128 / 255, 128 / 255 ],
  'white': [ 255 / 255, 255 / 255, 255 / 255 ],
  'maroon': [ 128 / 255, 0 / 255, 0 / 255 ],
  'red': [ 255 / 255, 0 / 255, 0 / 255 ],
  'purple': [ 128 / 255, 0 / 255, 128 / 255 ],
  'fuchsia': [ 255 / 255, 0 / 255, 255 / 255 ],
  'green': [ 0 / 255, 128 / 255, 0 / 255 ],
  'lime': [ 0 / 255, 255 / 255, 0 / 255 ],
  'olive': [ 128 / 255, 128 / 255, 0 / 255 ],
  'yellow': [ 255 / 255, 255 / 255, 0 / 255 ],
  'navy': [ 0 / 255, 0 / 255, 128 / 255 ],
  'blue': [ 0 / 255, 0 / 255, 255 / 255 ],
  'teal': [ 0 / 255, 128 / 255, 128 / 255 ],
  'aqua': [ 0 / 255, 255 / 255, 255 / 255 ],
// extended color keywords
  'aliceblue': [ 240 / 255, 248 / 255, 255 / 255 ],
  'antiquewhite': [ 250 / 255, 235 / 255, 215 / 255 ],
  //'aqua': [ 0 / 255, 255 / 255, 255 / 255 ],
  'aquamarine': [ 127 / 255, 255 / 255, 212 / 255 ],
  'azure': [ 240 / 255, 255 / 255, 255 / 255 ],
  'beige': [ 245 / 255, 245 / 255, 220 / 255 ],
  'bisque': [ 255 / 255, 228 / 255, 196 / 255 ],
  //'black': [ 0 / 255, 0 / 255, 0 / 255 ],
  'blanchedalmond': [ 255 / 255, 235 / 255, 205 / 255 ],
  //'blue': [ 0 / 255, 0 / 255, 255 / 255 ],
  'blueviolet': [ 138 / 255, 43 / 255, 226 / 255 ],
  'brown': [ 165 / 255, 42 / 255, 42 / 255 ],
  'burlywood': [ 222 / 255, 184 / 255, 135 / 255 ],
  'cadetblue': [ 95 / 255, 158 / 255, 160 / 255 ],
  'chartreuse': [ 127 / 255, 255 / 255, 0 / 255 ],
  'chocolate': [ 210 / 255, 105 / 255, 30 / 255 ],
  'coral': [ 255 / 255, 127 / 255, 80 / 255 ],
  'cornflowerblue': [ 100 / 255, 149 / 255, 237 / 255 ],
  'cornsilk': [ 255 / 255, 248 / 255, 220 / 255 ],
  'crimson': [ 220 / 255, 20 / 255, 60 / 255 ],
  'cyan': [ 0 / 255, 255 / 255, 255 / 255 ],
  'darkblue': [ 0 / 255, 0 / 255, 139 / 255 ],
  'darkcyan': [ 0 / 255, 139 / 255, 139 / 255 ],
  'darkgoldenrod': [ 184 / 255, 134 / 255, 11 / 255 ],
  'darkgray': [ 169 / 255, 169 / 255, 169 / 255 ],
  'darkgreen': [ 0 / 255, 100 / 255, 0 / 255 ],
  'darkgrey': [ 169 / 255, 169 / 255, 169 / 255 ],
  'darkkhaki': [ 189 / 255, 183 / 255, 107 / 255 ],
  'darkmagenta': [ 139 / 255, 0 / 255, 139 / 255 ],
  'darkolivegreen': [ 85 / 255, 107 / 255, 47 / 255 ],
  'darkorange': [ 255 / 255, 140 / 255, 0 / 255 ],
  'darkorchid': [ 153 / 255, 50 / 255, 204 / 255 ],
  'darkred': [ 139 / 255, 0 / 255, 0 / 255 ],
  'darksalmon': [ 233 / 255, 150 / 255, 122 / 255 ],
  'darkseagreen': [ 143 / 255, 188 / 255, 143 / 255 ],
  'darkslateblue': [ 72 / 255, 61 / 255, 139 / 255 ],
  'darkslategray': [ 47 / 255, 79 / 255, 79 / 255 ],
  'darkslategrey': [ 47 / 255, 79 / 255, 79 / 255 ],
  'darkturquoise': [ 0 / 255, 206 / 255, 209 / 255 ],
  'darkviolet': [ 148 / 255, 0 / 255, 211 / 255 ],
  'deeppink': [ 255 / 255, 20 / 255, 147 / 255 ],
  'deepskyblue': [ 0 / 255, 191 / 255, 255 / 255 ],
  'dimgray': [ 105 / 255, 105 / 255, 105 / 255 ],
  'dimgrey': [ 105 / 255, 105 / 255, 105 / 255 ],
  'dodgerblue': [ 30 / 255, 144 / 255, 255 / 255 ],
  'firebrick': [ 178 / 255, 34 / 255, 34 / 255 ],
  'floralwhite': [ 255 / 255, 250 / 255, 240 / 255 ],
  'forestgreen': [ 34 / 255, 139 / 255, 34 / 255 ],
  //'fuchsia': [ 255 / 255, 0 / 255, 255 / 255 ],
  'gainsboro': [ 220 / 255, 220 / 255, 220 / 255 ],
  'ghostwhite': [ 248 / 255, 248 / 255, 255 / 255 ],
  'gold': [ 255 / 255, 215 / 255, 0 / 255 ],
  'goldenrod': [ 218 / 255, 165 / 255, 32 / 255 ],
  //'gray': [ 128 / 255, 128 / 255, 128 / 255 ],
  //'green': [ 0 / 255, 128 / 255, 0 / 255 ],
  'greenyellow': [ 173 / 255, 255 / 255, 47 / 255 ],
  'grey': [ 128 / 255, 128 / 255, 128 / 255 ],
  'honeydew': [ 240 / 255, 255 / 255, 240 / 255 ],
  'hotpink': [ 255 / 255, 105 / 255, 180 / 255 ],
  'indianred': [ 205 / 255, 92 / 255, 92 / 255 ],
  'indigo': [ 75 / 255, 0 / 255, 130 / 255 ],
  'ivory': [ 255 / 255, 255 / 255, 240 / 255 ],
  'khaki': [ 240 / 255, 230 / 255, 140 / 255 ],
  'lavender': [ 230 / 255, 230 / 255, 250 / 255 ],
  'lavenderblush': [ 255 / 255, 240 / 255, 245 / 255 ],
  'lawngreen': [ 124 / 255, 252 / 255, 0 / 255 ],
  'lemonchiffon': [ 255 / 255, 250 / 255, 205 / 255 ],
  'lightblue': [ 173 / 255, 216 / 255, 230 / 255 ],
  'lightcoral': [ 240 / 255, 128 / 255, 128 / 255 ],
  'lightcyan': [ 224 / 255, 255 / 255, 255 / 255 ],
  'lightgoldenrodyellow': [ 250 / 255, 250 / 255, 210 / 255 ],
  'lightgray': [ 211 / 255, 211 / 255, 211 / 255 ],
  'lightgreen': [ 144 / 255, 238 / 255, 144 / 255 ],
  'lightgrey': [ 211 / 255, 211 / 255, 211 / 255 ],
  'lightpink': [ 255 / 255, 182 / 255, 193 / 255 ],
  'lightsalmon': [ 255 / 255, 160 / 255, 122 / 255 ],
  'lightseagreen': [ 32 / 255, 178 / 255, 170 / 255 ],
  'lightskyblue': [ 135 / 255, 206 / 255, 250 / 255 ],
  'lightslategray': [ 119 / 255, 136 / 255, 153 / 255 ],
  'lightslategrey': [ 119 / 255, 136 / 255, 153 / 255 ],
  'lightsteelblue': [ 176 / 255, 196 / 255, 222 / 255 ],
  'lightyellow': [ 255 / 255, 255 / 255, 224 / 255 ],
  //'lime': [ 0 / 255, 255 / 255, 0 / 255 ],
  'limegreen': [ 50 / 255, 205 / 255, 50 / 255 ],
  'linen': [ 250 / 255, 240 / 255, 230 / 255 ],
  'magenta': [ 255 / 255, 0 / 255, 255 / 255 ],
  //'maroon': [ 128 / 255, 0 / 255, 0 / 255 ],
  'mediumaquamarine': [ 102 / 255, 205 / 255, 170 / 255 ],
  'mediumblue': [ 0 / 255, 0 / 255, 205 / 255 ],
  'mediumorchid': [ 186 / 255, 85 / 255, 211 / 255 ],
  'mediumpurple': [ 147 / 255, 112 / 255, 219 / 255 ],
  'mediumseagreen': [ 60 / 255, 179 / 255, 113 / 255 ],
  'mediumslateblue': [ 123 / 255, 104 / 255, 238 / 255 ],
  'mediumspringgreen': [ 0 / 255, 250 / 255, 154 / 255 ],
  'mediumturquoise': [ 72 / 255, 209 / 255, 204 / 255 ],
  'mediumvioletred': [ 199 / 255, 21 / 255, 133 / 255 ],
  'midnightblue': [ 25 / 255, 25 / 255, 112 / 255 ],
  'mintcream': [ 245 / 255, 255 / 255, 250 / 255 ],
  'mistyrose': [ 255 / 255, 228 / 255, 225 / 255 ],
  'moccasin': [ 255 / 255, 228 / 255, 181 / 255 ],
  'navajowhite': [ 255 / 255, 222 / 255, 173 / 255 ],
  //'navy': [ 0 / 255, 0 / 255, 128 / 255 ],
  'oldlace': [ 253 / 255, 245 / 255, 230 / 255 ],
  //'olive': [ 128 / 255, 128 / 255, 0 / 255 ],
  'olivedrab': [ 107 / 255, 142 / 255, 35 / 255 ],
  'orange': [ 255 / 255, 165 / 255, 0 / 255 ],
  'orangered': [ 255 / 255, 69 / 255, 0 / 255 ],
  'orchid': [ 218 / 255, 112 / 255, 214 / 255 ],
  'palegoldenrod': [ 238 / 255, 232 / 255, 170 / 255 ],
  'palegreen': [ 152 / 255, 251 / 255, 152 / 255 ],
  'paleturquoise': [ 175 / 255, 238 / 255, 238 / 255 ],
  'palevioletred': [ 219 / 255, 112 / 255, 147 / 255 ],
  'papayawhip': [ 255 / 255, 239 / 255, 213 / 255 ],
  'peachpuff': [ 255 / 255, 218 / 255, 185 / 255 ],
  'peru': [ 205 / 255, 133 / 255, 63 / 255 ],
  'pink': [ 255 / 255, 192 / 255, 203 / 255 ],
  'plum': [ 221 / 255, 160 / 255, 221 / 255 ],
  'powderblue': [ 176 / 255, 224 / 255, 230 / 255 ],
  //'purple': [ 128 / 255, 0 / 255, 128 / 255 ],
  //'red': [ 255 / 255, 0 / 255, 0 / 255 ],
  'rosybrown': [ 188 / 255, 143 / 255, 143 / 255 ],
  'royalblue': [ 65 / 255, 105 / 255, 225 / 255 ],
  'saddlebrown': [ 139 / 255, 69 / 255, 19 / 255 ],
  'salmon': [ 250 / 255, 128 / 255, 114 / 255 ],
  'sandybrown': [ 244 / 255, 164 / 255, 96 / 255 ],
  'seagreen': [ 46 / 255, 139 / 255, 87 / 255 ],
  'seashell': [ 255 / 255, 245 / 255, 238 / 255 ],
  'sienna': [ 160 / 255, 82 / 255, 45 / 255 ],
  //'silver': [ 192 / 255, 192 / 255, 192 / 255 ],
  'skyblue': [ 135 / 255, 206 / 255, 235 / 255 ],
  'slateblue': [ 106 / 255, 90 / 255, 205 / 255 ],
  'slategray': [ 112 / 255, 128 / 255, 144 / 255 ],
  'slategrey': [ 112 / 255, 128 / 255, 144 / 255 ],
  'snow': [ 255 / 255, 250 / 255, 250 / 255 ],
  'springgreen': [ 0 / 255, 255 / 255, 127 / 255 ],
  'steelblue': [ 70 / 255, 130 / 255, 180 / 255 ],
  'tan': [ 210 / 255, 180 / 255, 140 / 255 ],
  //'teal': [ 0 / 255, 128 / 255, 128 / 255 ],
  'thistle': [ 216 / 255, 191 / 255, 216 / 255 ],
  'tomato': [ 255 / 255, 99 / 255, 71 / 255 ],
  'turquoise': [ 64 / 255, 224 / 255, 208 / 255 ],
  'violet': [ 238 / 255, 130 / 255, 238 / 255 ],
  'wheat': [ 245 / 255, 222 / 255, 179 / 255 ],
  //'white': [ 255 / 255, 255 / 255, 255 / 255 ],
  'whitesmoke': [ 245 / 255, 245 / 255, 245 / 255 ],
  //'yellow': [ 255 / 255, 255 / 255, 0 / 255 ],
  'yellowgreen': [ 154 / 255, 205 / 255, 50 / 255 ],
};

/**
 * Converts an CSS color name to RGB color.
 *
 * @param   String  s       The CSS color name
 * @return  Array           The RGB representation, or [0,0,0] default
 */
function css2rgb(s) {
  return cssColors[s.toLowerCase()]
}

// color( (array[r,g,b] | css-string) [,alpha] (,array[objects] | list of objects) )
function color () {
  var o, i = 1, a = arguments, c = a[0], alpha;

  // assume first argument is RGB array
  // but check if first argument is CSS string
  if (typeof c == 'string') {
    c = css2rgb(c);
  }
  // check if second argument is alpha
  if (Number.isFinite(a[i])) {
    c = c.concat(a[i]);
    i++;
  }
  // check if next argument is an an array
  if (Array.isArray(a[i])) { a = a[i], i = 0; } // use this as the list of objects
  for (o = a[i++]; i < a.length; i++) {
    o = o.union(a[i]);
  }
  return o.setColor(c)
}

// from http://axonflux.com/handy-rgb-to-hsl-and-rgb-to-hsv-color-model-c
/**
 * Converts an RGB color value to HSL. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes r, g, and b are contained in the set [0, 1] and
 * returns h, s, and l in the set [0, 1].
 *
 * @param   Number  r       The red color value
 * @param   Number  g       The green color value
 * @param   Number  b       The blue color value
 * @return  Array           The HSL representation
 */
function rgb2hsl (r, g, b) {
  if (r.length) { b = r[2], g = r[1], r = r[0]; }
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, l = (max + min) / 2;

  if (max == min) {
    h = s = 0; // achromatic
  } else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break
      case g:
        h = (b - r) / d + 2;
        break
      case b:
        h = (r - g) / d + 4;
        break
    }
    h /= 6;
  }

  return [h, s, l]
}

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 1].
 *
 * @param   Number  h       The hue
 * @param   Number  s       The saturation
 * @param   Number  l       The lightness
 * @return  Array           The RGB representation
 */
function hsl2rgb (h, s, l) {
  if (h.length) { l = h[2], s = h[1], h = h[0]; }
  var r, g, b;

  if (s == 0) {
    r = g = b = l; // achromatic
  } else {
    function hue2rgb (p, q, t) {
      if (t < 0) { t += 1; }
      if (t > 1) { t -= 1; }
      if (t < 1 / 6) { return p + (q - p) * 6 * t }
      if (t < 1 / 2) { return q }
      if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6 }
      return p
    }

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r, g, b]
}

/**
 * Converts an RGB color value to HSV. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
 * Assumes r, g, and b are contained in the set [0, 1] and
 * returns h, s, and v in the set [0, 1].
 *
 * @param   Number  r       The red color value
 * @param   Number  g       The green color value
 * @param   Number  b       The blue color value
 * @return  Array           The HSV representation
 */

function rgb2hsv (r, g, b) {
  if (r.length) { b = r[2], g = r[1], r = r[0]; }
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, v = max;

  var d = max - min;
  s = max == 0 ? 0 : d / max;

  if (max == min) {
    h = 0; // achromatic
  } else {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break
      case g:
        h = (b - r) / d + 2;
        break
      case b:
        h = (r - g) / d + 4;
        break
    }
    h /= 6;
  }

  return [h, s, v]
}

/**
 * Converts an HSV color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
 * Assumes h, s, and v are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 1].
 *
 * @param   Number  h       The hue
 * @param   Number  s       The saturation
 * @param   Number  v       The value
 * @return  Array           The RGB representation
 */
function hsv2rgb (h, s, v) {
  if (h.length) { v = h[2], s = h[1], h = h[0]; }
  var r, g, b;

  var i = Math.floor(h * 6);
  var f = h * 6 - i;
  var p = v * (1 - s);
  var q = v * (1 - f * s);
  var t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      r = v, g = t, b = p;
      break
    case 1:
      r = q, g = v, b = p;
      break
    case 2:
      r = p, g = v, b = t;
      break
    case 3:
      r = p, g = q, b = v;
      break
    case 4:
      r = t, g = p, b = v;
      break
    case 5:
      r = v, g = p, b = q;
      break
  }

  return [r, g, b]
}

/**
 * Converts a HTML5 color value (string) to RGB values
 * See the color input type of HTML5 forms
 * Conversion formula:
 * - split the string; "#RRGGBB" into RGB components
 * - convert the HEX value into RGB values
 */
function html2rgb (s) {
  var r = 0;
  var g = 0;
  var b = 0;
  if (s.length == 7) {
    r = parseInt('0x' + s.slice(1, 3)) / 255;
    g = parseInt('0x' + s.slice(3, 5)) / 255;
    b = parseInt('0x' + s.slice(5, 7)) / 255;
  }
  return [r, g, b]
}

/**
 * Converts RGB color value to HTML5 color value (string)
 * Conversion forumla:
 * - convert R, G, B into HEX strings
 * - return HTML formatted string "#RRGGBB"
 */
function rgb2html (r, g, b) {
  if (r.length) { b = r[2], g = r[1], r = r[0]; }
  var s = '#' +
  Number(0x1000000 + r * 255 * 0x10000 + g * 255 * 0x100 + b * 255).toString(16).substring(1,7);
  return s
}


var color$1 = Object.freeze({
	css2rgb: css2rgb,
	color: color,
	rgb2hsl: rgb2hsl,
	hsl2rgb: hsl2rgb,
	rgb2hsv: rgb2hsv,
	hsv2rgb: hsv2rgb,
	html2rgb: html2rgb,
	rgb2html: rgb2html
});

// -- Math functions (360 deg based vs 2pi)

function sin (a) {
  return Math.sin(a / 360 * Math.PI * 2)
}
function cos (a) {
  return Math.cos(a / 360 * Math.PI * 2)
}
function asin (a) {
  return Math.asin(a) / (Math.PI * 2) * 360
}
function acos (a) {
  return Math.acos(a) / (Math.PI * 2) * 360
}
function tan (a) {
  return Math.tan(a / 360 * Math.PI * 2)
}
function atan (a) {
  return Math.atan(a) / (Math.PI * 2) * 360
}
function atan2 (a, b) {
  return Math.atan2(a, b) / (Math.PI * 2) * 360
}
function ceil (a) {
  return Math.ceil(a)
}
function floor (a) {
  return Math.floor(a)
}
function abs (a) {
  return Math.abs(a)
}
function min (a, b) {
  return a < b ? a : b
}
function max (a, b) {
  return a > b ? a : b
}
function rands (min, max, vn, seed) {
  // -- seed is ignored for now, FIX IT (requires reimplementation of random())
  //    see http://stackoverflow.com/questions/424292/how-to-create-my-own-javascript-random-number-generator-that-i-can-also-set-the
  var v = new Array(vn);
  for (var i = 0; i < vn; i++) {
    v[i] = Math.random() * (max - min) + min;
  }
}
function log (a) {
  return Math.log(a)
}
function lookup (ix, v) {
  var r = 0;
  for (var i = 0; i < v.length; i++) {
    var a0 = v[i];
    if (a0[0] >= ix) {
      i--;
      a0 = v[i];
      var a1 = v[i + 1];
      var m = 0;
      if (a0[0] !== a1[0]) {
        m = abs((ix - a0[0]) / (a1[0] - a0[0]));
      }
      // echo(">>",i,ix,a0[0],a1[0],";",m,a0[1],a1[1])
      if (m > 0) {
        r = a0[1] * (1 - m) + a1[1] * m;
      } else {
        r = a0[1];
      }
      return r
    }
  }
  return r
}

function pow (a, b) {
  return Math.pow(a, b)
}

function sign (a) {
  return a < 0 ? -1 : (a > 1 ? 1 : 0)
}

function sqrt (a) {
  return Math.sqrt(a)
}

function round (a) {
  return floor(a + 0.5)
}


var maths = Object.freeze({
	sin: sin,
	cos: cos,
	asin: asin,
	acos: acos,
	tan: tan,
	atan: atan,
	atan2: atan2,
	ceil: ceil,
	floor: floor,
	abs: abs,
	min: min,
	max: max,
	rands: rands,
	log: log,
	lookup: lookup,
	pow: pow,
	sign: sign,
	sqrt: sqrt,
	round: round
});

function vector_char(x,y,c) {
   c = c.charCodeAt(0);
   c -= 32;
   if(c<0||c>=95) { return { width: 0, segments: [] }; }

   var off = c*112;
   var n = simplexFont[off++];
   var w = simplexFont[off++];
   var l = [];
   var segs = [];

   for(var i=0; i<n; i++) {
      var xp = simplexFont[off+i*2];
      var yp = simplexFont[off+i*2+1];
      if(xp==-1&&yp==-1) {
         segs.push(l); l = [];
      } else {
         l.push([xp+x,yp+y]);
      }
   }
   if(l.length) { segs.push(l); }
   return { width: w, segments: segs };
}

function vector_text(x,y,s) {
   var o = [];
   var x0 = x;
   for(var i=0; i<s.length; i++) {
      var c = s.charAt(i);
      if(c=='\n') {
         x = x0; y -= 30;
      } else {
         var d = vector_char(x,y,c);
         x += d.width;
         o = o.concat(d.segments);
      }
   }
   return o;
}

// -- data below from http://paulbourke.net/dataformats/hershey/

var simplexFont = [
    0,16, /* Ascii 32 */
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,10, /* Ascii 33 */
    5,21, 5, 7,-1,-1, 5, 2, 4, 1, 5, 0, 6, 1, 5, 2,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,16, /* Ascii 34 */
    4,21, 4,14,-1,-1,12,21,12,14,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,21, /* Ascii 35 */
   11,25, 4,-7,-1,-1,17,25,10,-7,-1,-1, 4,12,18,12,-1,-1, 3, 6,17, 6,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   26,20, /* Ascii 36 */
    8,25, 8,-4,-1,-1,12,25,12,-4,-1,-1,17,18,15,20,12,21, 8,21, 5,20, 3,
   18, 3,16, 4,14, 5,13, 7,12,13,10,15, 9,16, 8,17, 6,17, 3,15, 1,12, 0,
    8, 0, 5, 1, 3, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   31,24, /* Ascii 37 */
   21,21, 3, 0,-1,-1, 8,21,10,19,10,17, 9,15, 7,14, 5,14, 3,16, 3,18, 4,
   20, 6,21, 8,21,10,20,13,19,16,19,19,20,21,21,-1,-1,17, 7,15, 6,14, 4,
   14, 2,16, 0,18, 0,20, 1,21, 3,21, 5,19, 7,17, 7,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   34,26, /* Ascii 38 */
   23,12,23,13,22,14,21,14,20,13,19,11,17, 6,15, 3,13, 1,11, 0, 7, 0, 5,
    1, 4, 2, 3, 4, 3, 6, 4, 8, 5, 9,12,13,13,14,14,16,14,18,13,20,11,21,
    9,20, 8,18, 8,16, 9,13,11,10,16, 3,18, 1,20, 0,22, 0,23, 1,23, 2,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    7,10, /* Ascii 39 */
    5,19, 4,20, 5,21, 6,20, 6,18, 5,16, 4,15,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,14, /* Ascii 40 */
   11,25, 9,23, 7,20, 5,16, 4,11, 4, 7, 5, 2, 7,-2, 9,-5,11,-7,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,14, /* Ascii 41 */
    3,25, 5,23, 7,20, 9,16,10,11,10, 7, 9, 2, 7,-2, 5,-5, 3,-7,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,16, /* Ascii 42 */
    8,21, 8, 9,-1,-1, 3,18,13,12,-1,-1,13,18, 3,12,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,26, /* Ascii 43 */
   13,18,13, 0,-1,-1, 4, 9,22, 9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,10, /* Ascii 44 */
    6, 1, 5, 0, 4, 1, 5, 2, 6, 1, 6,-1, 5,-3, 4,-4,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    2,26, /* Ascii 45 */
    4, 9,22, 9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,10, /* Ascii 46 */
    5, 2, 4, 1, 5, 0, 6, 1, 5, 2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    2,22, /* Ascii 47 */
   20,25, 2,-7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,20, /* Ascii 48 */
    9,21, 6,20, 4,17, 3,12, 3, 9, 4, 4, 6, 1, 9, 0,11, 0,14, 1,16, 4,17,
    9,17,12,16,17,14,20,11,21, 9,21,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    4,20, /* Ascii 49 */
    6,17, 8,18,11,21,11, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   14,20, /* Ascii 50 */
    4,16, 4,17, 5,19, 6,20, 8,21,12,21,14,20,15,19,16,17,16,15,15,13,13,
   10, 3, 0,17, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   15,20, /* Ascii 51 */
    5,21,16,21,10,13,13,13,15,12,16,11,17, 8,17, 6,16, 3,14, 1,11, 0, 8,
    0, 5, 1, 4, 2, 3, 4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    6,20, /* Ascii 52 */
   13,21, 3, 7,18, 7,-1,-1,13,21,13, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,20, /* Ascii 53 */
   15,21, 5,21, 4,12, 5,13, 8,14,11,14,14,13,16,11,17, 8,17, 6,16, 3,14,
    1,11, 0, 8, 0, 5, 1, 4, 2, 3, 4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   23,20, /* Ascii 54 */
   16,18,15,20,12,21,10,21, 7,20, 5,17, 4,12, 4, 7, 5, 3, 7, 1,10, 0,11,
    0,14, 1,16, 3,17, 6,17, 7,16,10,14,12,11,13,10,13, 7,12, 5,10, 4, 7,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,20, /* Ascii 55 */
   17,21, 7, 0,-1,-1, 3,21,17,21,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   29,20, /* Ascii 56 */
    8,21, 5,20, 4,18, 4,16, 5,14, 7,13,11,12,14,11,16, 9,17, 7,17, 4,16,
    2,15, 1,12, 0, 8, 0, 5, 1, 4, 2, 3, 4, 3, 7, 4, 9, 6,11, 9,12,13,13,
   15,14,16,16,16,18,15,20,12,21, 8,21,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   23,20, /* Ascii 57 */
   16,14,15,11,13, 9,10, 8, 9, 8, 6, 9, 4,11, 3,14, 3,15, 4,18, 6,20, 9,
   21,10,21,13,20,15,18,16,14,16, 9,15, 4,13, 1,10, 0, 8, 0, 5, 1, 4, 3,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,10, /* Ascii 58 */
    5,14, 4,13, 5,12, 6,13, 5,14,-1,-1, 5, 2, 4, 1, 5, 0, 6, 1, 5, 2,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   14,10, /* Ascii 59 */
    5,14, 4,13, 5,12, 6,13, 5,14,-1,-1, 6, 1, 5, 0, 4, 1, 5, 2, 6, 1, 6,
   -1, 5,-3, 4,-4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    3,24, /* Ascii 60 */
   20,18, 4, 9,20, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,26, /* Ascii 61 */
    4,12,22,12,-1,-1, 4, 6,22, 6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    3,24, /* Ascii 62 */
    4,18,20, 9, 4, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   20,18, /* Ascii 63 */
    3,16, 3,17, 4,19, 5,20, 7,21,11,21,13,20,14,19,15,17,15,15,14,13,13,
   12, 9,10, 9, 7,-1,-1, 9, 2, 8, 1, 9, 0,10, 1, 9, 2,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   55,27, /* Ascii 64 */
   18,13,17,15,15,16,12,16,10,15, 9,14, 8,11, 8, 8, 9, 6,11, 5,14, 5,16,
    6,17, 8,-1,-1,12,16,10,14, 9,11, 9, 8,10, 6,11, 5,-1,-1,18,16,17, 8,
   17, 6,19, 5,21, 5,23, 7,24,10,24,12,23,15,22,17,20,19,18,20,15,21,12,
   21, 9,20, 7,19, 5,17, 4,15, 3,12, 3, 9, 4, 6, 5, 4, 7, 2, 9, 1,12, 0,
   15, 0,18, 1,20, 2,21, 3,-1,-1,19,16,18, 8,18, 6,19, 5,
    8,18, /* Ascii 65 */
    9,21, 1, 0,-1,-1, 9,21,17, 0,-1,-1, 4, 7,14, 7,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   23,21, /* Ascii 66 */
    4,21, 4, 0,-1,-1, 4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,
   11,-1,-1, 4,11,13,11,16,10,17, 9,18, 7,18, 4,17, 2,16, 1,13, 0, 4, 0,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   18,21, /* Ascii 67 */
   18,16,17,18,15,20,13,21, 9,21, 7,20, 5,18, 4,16, 3,13, 3, 8, 4, 5, 5,
    3, 7, 1, 9, 0,13, 0,15, 1,17, 3,18, 5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   15,21, /* Ascii 68 */
    4,21, 4, 0,-1,-1, 4,21,11,21,14,20,16,18,17,16,18,13,18, 8,17, 5,16,
    3,14, 1,11, 0, 4, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,19, /* Ascii 69 */
    4,21, 4, 0,-1,-1, 4,21,17,21,-1,-1, 4,11,12,11,-1,-1, 4, 0,17, 0,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,18, /* Ascii 70 */
    4,21, 4, 0,-1,-1, 4,21,17,21,-1,-1, 4,11,12,11,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   22,21, /* Ascii 71 */
   18,16,17,18,15,20,13,21, 9,21, 7,20, 5,18, 4,16, 3,13, 3, 8, 4, 5, 5,
    3, 7, 1, 9, 0,13, 0,15, 1,17, 3,18, 5,18, 8,-1,-1,13, 8,18, 8,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,22, /* Ascii 72 */
    4,21, 4, 0,-1,-1,18,21,18, 0,-1,-1, 4,11,18,11,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    2, 8, /* Ascii 73 */
    4,21, 4, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,16, /* Ascii 74 */
   12,21,12, 5,11, 2,10, 1, 8, 0, 6, 0, 4, 1, 3, 2, 2, 5, 2, 7,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,21, /* Ascii 75 */
    4,21, 4, 0,-1,-1,18,21, 4, 7,-1,-1, 9,12,18, 0,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,17, /* Ascii 76 */
    4,21, 4, 0,-1,-1, 4, 0,16, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,24, /* Ascii 77 */
    4,21, 4, 0,-1,-1, 4,21,12, 0,-1,-1,20,21,12, 0,-1,-1,20,21,20, 0,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,22, /* Ascii 78 */
    4,21, 4, 0,-1,-1, 4,21,18, 0,-1,-1,18,21,18, 0,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   21,22, /* Ascii 79 */
    9,21, 7,20, 5,18, 4,16, 3,13, 3, 8, 4, 5, 5, 3, 7, 1, 9, 0,13, 0,15,
    1,17, 3,18, 5,19, 8,19,13,18,16,17,18,15,20,13,21, 9,21,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   13,21, /* Ascii 80 */
    4,21, 4, 0,-1,-1, 4,21,13,21,16,20,17,19,18,17,18,14,17,12,16,11,13,
   10, 4,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   24,22, /* Ascii 81 */
    9,21, 7,20, 5,18, 4,16, 3,13, 3, 8, 4, 5, 5, 3, 7, 1, 9, 0,13, 0,15,
    1,17, 3,18, 5,19, 8,19,13,18,16,17,18,15,20,13,21, 9,21,-1,-1,12, 4,
   18,-2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   16,21, /* Ascii 82 */
    4,21, 4, 0,-1,-1, 4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,
   11, 4,11,-1,-1,11,11,18, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   20,20, /* Ascii 83 */
   17,18,15,20,12,21, 8,21, 5,20, 3,18, 3,16, 4,14, 5,13, 7,12,13,10,15,
    9,16, 8,17, 6,17, 3,15, 1,12, 0, 8, 0, 5, 1, 3, 3,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,16, /* Ascii 84 */
    8,21, 8, 0,-1,-1, 1,21,15,21,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,22, /* Ascii 85 */
    4,21, 4, 6, 5, 3, 7, 1,10, 0,12, 0,15, 1,17, 3,18, 6,18,21,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,18, /* Ascii 86 */
    1,21, 9, 0,-1,-1,17,21, 9, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,24, /* Ascii 87 */
    2,21, 7, 0,-1,-1,12,21, 7, 0,-1,-1,12,21,17, 0,-1,-1,22,21,17, 0,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,20, /* Ascii 88 */
    3,21,17, 0,-1,-1,17,21, 3, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    6,18, /* Ascii 89 */
    1,21, 9,11, 9, 0,-1,-1,17,21, 9,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,20, /* Ascii 90 */
   17,21, 3, 0,-1,-1, 3,21,17,21,-1,-1, 3, 0,17, 0,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,14, /* Ascii 91 */
    4,25, 4,-7,-1,-1, 5,25, 5,-7,-1,-1, 4,25,11,25,-1,-1, 4,-7,11,-7,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    2,14, /* Ascii 92 */
    0,21,14,-3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,14, /* Ascii 93 */
    9,25, 9,-7,-1,-1,10,25,10,-7,-1,-1, 3,25,10,25,-1,-1, 3,-7,10,-7,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,16, /* Ascii 94 */
    6,15, 8,18,10,15,-1,-1, 3,12, 8,17,13,12,-1,-1, 8,17, 8, 0,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    2,16, /* Ascii 95 */
    0,-2,16,-2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    7,10, /* Ascii 96 */
    6,21, 5,20, 4,18, 4,16, 5,15, 6,16, 5,17,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,19, /* Ascii 97 */
   15,14,15, 0,-1,-1,15,11,13,13,11,14, 8,14, 6,13, 4,11, 3, 8, 3, 6, 4,
    3, 6, 1, 8, 0,11, 0,13, 1,15, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,19, /* Ascii 98 */
    4,21, 4, 0,-1,-1, 4,11, 6,13, 8,14,11,14,13,13,15,11,16, 8,16, 6,15,
    3,13, 1,11, 0, 8, 0, 6, 1, 4, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   14,18, /* Ascii 99 */
   15,11,13,13,11,14, 8,14, 6,13, 4,11, 3, 8, 3, 6, 4, 3, 6, 1, 8, 0,11,
    0,13, 1,15, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,19, /* Ascii 100 */
   15,21,15, 0,-1,-1,15,11,13,13,11,14, 8,14, 6,13, 4,11, 3, 8, 3, 6, 4,
    3, 6, 1, 8, 0,11, 0,13, 1,15, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,18, /* Ascii 101 */
    3, 8,15, 8,15,10,14,12,13,13,11,14, 8,14, 6,13, 4,11, 3, 8, 3, 6, 4,
    3, 6, 1, 8, 0,11, 0,13, 1,15, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,12, /* Ascii 102 */
   10,21, 8,21, 6,20, 5,17, 5, 0,-1,-1, 2,14, 9,14,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   22,19, /* Ascii 103 */
   15,14,15,-2,14,-5,13,-6,11,-7, 8,-7, 6,-6,-1,-1,15,11,13,13,11,14, 8,
   14, 6,13, 4,11, 3, 8, 3, 6, 4, 3, 6, 1, 8, 0,11, 0,13, 1,15, 3,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,19, /* Ascii 104 */
    4,21, 4, 0,-1,-1, 4,10, 7,13, 9,14,12,14,14,13,15,10,15, 0,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8, 8, /* Ascii 105 */
    3,21, 4,20, 5,21, 4,22, 3,21,-1,-1, 4,14, 4, 0,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,10, /* Ascii 106 */
    5,21, 6,20, 7,21, 6,22, 5,21,-1,-1, 6,14, 6,-3, 5,-6, 3,-7, 1,-7,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,17, /* Ascii 107 */
    4,21, 4, 0,-1,-1,14,14, 4, 4,-1,-1, 8, 8,15, 0,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    2, 8, /* Ascii 108 */
    4,21, 4, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   18,30, /* Ascii 109 */
    4,14, 4, 0,-1,-1, 4,10, 7,13, 9,14,12,14,14,13,15,10,15, 0,-1,-1,15,
   10,18,13,20,14,23,14,25,13,26,10,26, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,19, /* Ascii 110 */
    4,14, 4, 0,-1,-1, 4,10, 7,13, 9,14,12,14,14,13,15,10,15, 0,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,19, /* Ascii 111 */
    8,14, 6,13, 4,11, 3, 8, 3, 6, 4, 3, 6, 1, 8, 0,11, 0,13, 1,15, 3,16,
    6,16, 8,15,11,13,13,11,14, 8,14,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,19, /* Ascii 112 */
    4,14, 4,-7,-1,-1, 4,11, 6,13, 8,14,11,14,13,13,15,11,16, 8,16, 6,15,
    3,13, 1,11, 0, 8, 0, 6, 1, 4, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,19, /* Ascii 113 */
   15,14,15,-7,-1,-1,15,11,13,13,11,14, 8,14, 6,13, 4,11, 3, 8, 3, 6, 4,
    3, 6, 1, 8, 0,11, 0,13, 1,15, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,13, /* Ascii 114 */
    4,14, 4, 0,-1,-1, 4, 8, 5,11, 7,13, 9,14,12,14,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   17,17, /* Ascii 115 */
   14,11,13,13,10,14, 7,14, 4,13, 3,11, 4, 9, 6, 8,11, 7,13, 6,14, 4,14,
    3,13, 1,10, 0, 7, 0, 4, 1, 3, 3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,12, /* Ascii 116 */
    5,21, 5, 4, 6, 1, 8, 0,10, 0,-1,-1, 2,14, 9,14,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   10,19, /* Ascii 117 */
    4,14, 4, 4, 5, 1, 7, 0,10, 0,12, 1,15, 4,-1,-1,15,14,15, 0,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,16, /* Ascii 118 */
    2,14, 8, 0,-1,-1,14,14, 8, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   11,22, /* Ascii 119 */
    3,14, 7, 0,-1,-1,11,14, 7, 0,-1,-1,11,14,15, 0,-1,-1,19,14,15, 0,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    5,17, /* Ascii 120 */
    3,14,14, 0,-1,-1,14,14, 3, 0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    9,16, /* Ascii 121 */
    2,14, 8, 0,-1,-1,14,14, 8, 0, 6,-4, 4,-6, 2,-7, 1,-7,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    8,17, /* Ascii 122 */
   14,14, 3, 0,-1,-1, 3,14,14,14,-1,-1, 3, 0,14, 0,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   39,14, /* Ascii 123 */
    9,25, 7,24, 6,23, 5,21, 5,19, 6,17, 7,16, 8,14, 8,12, 6,10,-1,-1, 7,
   24, 6,22, 6,20, 7,18, 8,17, 9,15, 9,13, 8,11, 4, 9, 8, 7, 9, 5, 9, 3,
    8, 1, 7, 0, 6,-2, 6,-4, 7,-6,-1,-1, 6, 8, 8, 6, 8, 4, 7, 2, 6, 1, 5,
   -1, 5,-3, 6,-5, 7,-6, 9,-7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    2, 8, /* Ascii 124 */
    4,25, 4,-7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   39,14, /* Ascii 125 */
    5,25, 7,24, 8,23, 9,21, 9,19, 8,17, 7,16, 6,14, 6,12, 8,10,-1,-1, 7,
   24, 8,22, 8,20, 7,18, 6,17, 5,15, 5,13, 6,11,10, 9, 6, 7, 5, 5, 5, 3,
    6, 1, 7, 0, 8,-2, 8,-4, 7,-6,-1,-1, 8, 8, 6, 6, 6, 4, 7, 2, 8, 1, 9,
   -1, 9,-3, 8,-5, 7,-6, 5,-7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   23,24, /* Ascii 126 */
    3, 6, 3, 8, 4,11, 6,12, 8,12,10,11,14, 8,16, 7,18, 7,20, 8,21,10,-1,
   -1, 3, 8, 4,10, 6,11, 8,11,10,10,14, 7,16, 6,18, 6,20, 7,21,10,21,12,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1 ];


var text = Object.freeze({
	vector_char: vector_char,
	vector_text: vector_text
});

function echo () {
  console.warn('echo() will be deprecated in the near future: please use console.log/warn/error instead');
  var s = '', a = arguments;
  for (var i = 0; i < a.length; i++) {
    if (i) { s += ', '; }
    s += a[i];
  }
  // var t = (new Date()-global.time)/1000
  // console.log(t,s)
  console.log(s);
}

/**
sprintf() for JavaScript 0.7-beta1
http://www.diveintojavascript.com/projects/javascript-sprintf

Copyright (c) Alexandru Marasteanu <alexaholic [at) gmail (dot] com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of sprintf() for JavaScript nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL Alexandru Marasteanu BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Changelog:
2010.09.06 - 0.7-beta1
  - features: vsprintf, support for named placeholders
  - enhancements: format cache, reduced global namespace pollution

2010.05.22 - 0.6:
 - reverted to 0.4 and fixed the bug regarding the sign of the number 0
 Note:
 Thanks to Raphael Pigulla <raph (at] n3rd [dot) org> (http://www.n3rd.org/)
 who warned me about a bug in 0.5, I discovered that the last update was
 a regress. I appologize for that.

2010.05.09 - 0.5:
 - bug fix: 0 is now preceeded with a + sign
 - bug fix: the sign was not at the right position on padded results (Kamal Abdali)
 - switched from GPL to BSD license

2007.10.21 - 0.4:
 - unit test and patch (David Baird)

2007.09.17 - 0.3:
 - bug fix: no longer throws exception on empty paramenters (Hans Pufal)

2007.09.11 - 0.2:
 - feature: added argument swapping

2007.04.03 - 0.1:
 - initial release
**/

var sprintf = (function () {
  function get_type (variable) {
    return Object.prototype.toString.call(variable).slice(8, -1).toLowerCase()
  }
  function str_repeat (input, multiplier) {
    for (var output = []; multiplier > 0; output[--multiplier] = input) { /* do nothing */}
    return output.join('')
  }

  var str_format = function () {
    if (!str_format.cache.hasOwnProperty(arguments[0])) {
      str_format.cache[arguments[0]] = str_format.parse(arguments[0]);
    }
    return str_format.format.call(null, str_format.cache[arguments[0]], arguments)
  };

  str_format.format = function (parse_tree, argv) {
    var cursor = 1, tree_length = parse_tree.length, node_type = '', arg, output = [], i, k, match, pad, pad_character, pad_length;
    for (i = 0; i < tree_length; i++) {
      node_type = get_type(parse_tree[i]);
      if (node_type === 'string') {
        output.push(parse_tree[i]);
      }
      else if (node_type === 'array') {
        match = parse_tree[i]; // convenience purposes only
        if (match[2]) { // keyword argument
          arg = argv[cursor];
          for (k = 0; k < match[2].length; k++) {
            if (!arg.hasOwnProperty(match[2][k])) {
              throw(sprintf('[sprintf] property "%s" does not exist', match[2][k]))
            }
            arg = arg[match[2][k]];
          }
        }
        else if (match[1]) { // positional argument (explicit)
          arg = argv[match[1]];
        } else { // positional argument (implicit)
          arg = argv[cursor++];
        }

        if (/[^s]/.test(match[8]) && (get_type(arg) != 'number')) {
          throw(sprintf('[sprintf] expecting number but found %s', get_type(arg)))
        }
        switch (match[8]) {
          case 'b':
            arg = arg.toString(2);
            break
          case 'c':
            arg = String.fromCharCode(arg);
            break
          case 'd':
            arg = parseInt(arg, 10);
            break
          case 'e':
            arg = match[7] ? arg.toExponential(match[7]) : arg.toExponential();
            break
          case 'f':
            arg = match[7] ? parseFloat(arg).toFixed(match[7]) : parseFloat(arg);
            break
          case 'o':
            arg = arg.toString(8);
            break
          case 's':
            arg = ((arg = String(arg)) && match[7] ? arg.substring(0, match[7]) : arg);
            break
          case 'u':
            arg = Math.abs(arg);
            break
          case 'x':
            arg = arg.toString(16);
            break
          case 'X':
            arg = arg.toString(16).toUpperCase();
            break
        }
        arg = (/[def]/.test(match[8]) && match[3] && arg >= 0 ? '+' + arg : arg);
        pad_character = match[4] ? match[4] == '0' ? '0' : match[4].charAt(1) : ' ';
        pad_length = match[6] - String(arg).length;
        pad = match[6] ? str_repeat(pad_character, pad_length) : '';
        output.push(match[5] ? arg + pad : pad + arg);
      }
    }
    return output.join('')
  };

  str_format.cache = {};

  str_format.parse = function (fmt) {
    var _fmt = fmt, match = [], parse_tree = [], arg_names = 0;
    while (_fmt) {
      if ((match = /^[^\x25]+/.exec(_fmt)) !== null) {
        parse_tree.push(match[0]);
      }
      else if ((match = /^\x25{2}/.exec(_fmt)) !== null) {
        parse_tree.push('%');
      }
      else if ((match = /^\x25(?:([1-9]\d*)\$|\(([^\)]+)\))?(\+)?(0|'[^$])?(-)?(\d+)?(?:\.(\d+))?([b-fosuxX])/.exec(_fmt)) !== null) {
        if (match[2]) {
          arg_names |= 1;
          var field_list = [], replacement_field = match[2], field_match = [];
          if ((field_match = /^([a-z_][a-z_\d]*)/i.exec(replacement_field)) !== null) {
            field_list.push(field_match[1]);
            while ((replacement_field = replacement_field.substring(field_match[0].length)) !== '') {
              if ((field_match = /^\.([a-z_][a-z_\d]*)/i.exec(replacement_field)) !== null) {
                field_list.push(field_match[1]);
              }
              else if ((field_match = /^\[(\d+)\]/.exec(replacement_field)) !== null) {
                field_list.push(field_match[1]);
              } else {
                throw('[sprintf] huh?')
              }
            }
          } else {
            throw('[sprintf] huh?')
          }
          match[2] = field_list;
        } else {
          arg_names |= 2;
        }
        if (arg_names === 3) {
          throw('[sprintf] mixing positional and named placeholders is not (yet) supported')
        }
        parse_tree.push(match);
      } else {
        throw('[sprintf] huh?')
      }
      _fmt = _fmt.substring(match[0].length);
    }
    return parse_tree
  };

  return str_format
})();

function log$1 (txt) {
  var timeInMs = Date.now();
  var prevtime = undefined;//OpenJsCad.log.prevLogTime
  if (!prevtime) { prevtime = timeInMs; }
  var deltatime = timeInMs - prevtime;
  log$1.prevLogTime = timeInMs;
  var timefmt = (deltatime * 0.001).toFixed(3);
  txt = '[' + timefmt + '] ' + txt;
  if ((typeof (console) === 'object') && (typeof (console.log) === 'function')) {
    console.log(txt);
  } else if ((typeof (self) === 'object') && (typeof (self.postMessage) === 'function')) {
    self.postMessage({cmd: 'log', txt: txt});
  }
  else { throw new Error('Cannot log') }
}

// See Processor.setStatus()
// Note: leave for compatibility

// these are 'external' to this folder ...needs to be reviewed
// mostly likely needs to be removed since it is in the OpenJsCad namespace anyway, leaving here
// for now

var exportedApi = {
  csg: {CAG: _jscad_csg.CAG, CSG: _jscad_csg.CSG},
  primitives2d: primitives2d,
  primitives3d: primitives3d,
  booleanOps: booleanOps,
  transformations: transformations,
  extrusions: extrusions,
  color: color$1,
  maths: maths,
  text: text,
  OpenJsCad: {OpenJsCad: {log: log$1}},
  debug: {echo: echo}
};

module.exports = exportedApi;


},{"@jscad/csg":1}],4:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function placeHoldersCount (b64) {
  var len = b64.length
  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  return b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0
}

function byteLength (b64) {
  // base64 is 4/3 + up to two characters of the original data
  return b64.length * 3 / 4 - placeHoldersCount(b64)
}

function toByteArray (b64) {
  var i, j, l, tmp, placeHolders, arr
  var len = b64.length
  placeHolders = placeHoldersCount(b64)

  arr = new Arr(len * 3 / 4 - placeHolders)

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len

  var L = 0

  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
    arr[L++] = (tmp >> 16) & 0xFF
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[L++] = tmp & 0xFF
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var output = ''
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    output += lookup[tmp >> 2]
    output += lookup[(tmp << 4) & 0x3F]
    output += '=='
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
    output += lookup[tmp >> 10]
    output += lookup[(tmp >> 4) & 0x3F]
    output += lookup[(tmp << 2) & 0x3F]
    output += '='
  }

  parts.push(output)

  return parts.join('')
}

},{}],5:[function(require,module,exports){

},{}],6:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":8}],7:[function(require,module,exports){
(function (global){
'use strict';

var buffer = require('buffer');
var Buffer = buffer.Buffer;
var SlowBuffer = buffer.SlowBuffer;
var MAX_LEN = buffer.kMaxLength || 2147483647;
exports.alloc = function alloc(size, fill, encoding) {
  if (typeof Buffer.alloc === 'function') {
    return Buffer.alloc(size, fill, encoding);
  }
  if (typeof encoding === 'number') {
    throw new TypeError('encoding must not be number');
  }
  if (typeof size !== 'number') {
    throw new TypeError('size must be a number');
  }
  if (size > MAX_LEN) {
    throw new RangeError('size is too large');
  }
  var enc = encoding;
  var _fill = fill;
  if (_fill === undefined) {
    enc = undefined;
    _fill = 0;
  }
  var buf = new Buffer(size);
  if (typeof _fill === 'string') {
    var fillBuf = new Buffer(_fill, enc);
    var flen = fillBuf.length;
    var i = -1;
    while (++i < size) {
      buf[i] = fillBuf[i % flen];
    }
  } else {
    buf.fill(_fill);
  }
  return buf;
}
exports.allocUnsafe = function allocUnsafe(size) {
  if (typeof Buffer.allocUnsafe === 'function') {
    return Buffer.allocUnsafe(size);
  }
  if (typeof size !== 'number') {
    throw new TypeError('size must be a number');
  }
  if (size > MAX_LEN) {
    throw new RangeError('size is too large');
  }
  return new Buffer(size);
}
exports.from = function from(value, encodingOrOffset, length) {
  if (typeof Buffer.from === 'function' && (!global.Uint8Array || Uint8Array.from !== Buffer.from)) {
    return Buffer.from(value, encodingOrOffset, length);
  }
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number');
  }
  if (typeof value === 'string') {
    return new Buffer(value, encodingOrOffset);
  }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    var offset = encodingOrOffset;
    if (arguments.length === 1) {
      return new Buffer(value);
    }
    if (typeof offset === 'undefined') {
      offset = 0;
    }
    var len = length;
    if (typeof len === 'undefined') {
      len = value.byteLength - offset;
    }
    if (offset >= value.byteLength) {
      throw new RangeError('\'offset\' is out of bounds');
    }
    if (len > value.byteLength - offset) {
      throw new RangeError('\'length\' is out of bounds');
    }
    return new Buffer(value.slice(offset, offset + len));
  }
  if (Buffer.isBuffer(value)) {
    var out = new Buffer(value.length);
    value.copy(out, 0, 0, value.length);
    return out;
  }
  if (value) {
    if (Array.isArray(value) || (typeof ArrayBuffer !== 'undefined' && value.buffer instanceof ArrayBuffer) || 'length' in value) {
      return new Buffer(value);
    }
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return new Buffer(value.data);
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ' + 'ArrayBuffer, Array, or array-like object.');
}
exports.allocUnsafeSlow = function allocUnsafeSlow(size) {
  if (typeof Buffer.allocUnsafeSlow === 'function') {
    return Buffer.allocUnsafeSlow(size);
  }
  if (typeof size !== 'number') {
    throw new TypeError('size must be a number');
  }
  if (size >= MAX_LEN) {
    throw new RangeError('size is too large');
  }
  return new SlowBuffer(size);
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"buffer":8}],8:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

/*
 * Export kMaxLength after typed array support is determined.
 */
exports.kMaxLength = kMaxLength()

function typedArraySupport () {
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = {__proto__: Uint8Array.prototype, foo: function () { return 42 }}
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

function createBuffer (that, length) {
  if (kMaxLength() < length) {
    throw new RangeError('Invalid typed array length')
  }
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(length)
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    if (that === null) {
      that = new Buffer(length)
    }
    that.length = length
  }

  return that
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
    return new Buffer(arg, encodingOrOffset, length)
  }

  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(this, arg)
  }
  return from(this, arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192 // not used by this implementation

// TODO: Legacy, not needed anymore. Remove in next major version.
Buffer._augment = function (arr) {
  arr.__proto__ = Buffer.prototype
  return arr
}

function from (that, value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return fromArrayBuffer(that, value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(that, value, encodingOrOffset)
  }

  return fromObject(that, value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(null, value, encodingOrOffset, length)
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
  if (typeof Symbol !== 'undefined' && Symbol.species &&
      Buffer[Symbol.species] === Buffer) {
    // Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
    Object.defineProperty(Buffer, Symbol.species, {
      value: null,
      configurable: true
    })
  }
}

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  } else if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }
}

function alloc (that, size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(that, size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(that, size).fill(fill, encoding)
      : createBuffer(that, size).fill(fill)
  }
  return createBuffer(that, size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(null, size, fill, encoding)
}

function allocUnsafe (that, size) {
  assertSize(size)
  that = createBuffer(that, size < 0 ? 0 : checked(size) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < size; ++i) {
      that[i] = 0
    }
  }
  return that
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(null, size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(null, size)
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('"encoding" must be a valid string encoding')
  }

  var length = byteLength(string, encoding) | 0
  that = createBuffer(that, length)

  var actual = that.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    that = that.slice(0, actual)
  }

  return that
}

function fromArrayLike (that, array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  that = createBuffer(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array, byteOffset, length) {
  array.byteLength // this throws if `array` is not a valid ArrayBuffer

  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('\'offset\' is out of bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('\'length\' is out of bounds')
  }

  if (byteOffset === undefined && length === undefined) {
    array = new Uint8Array(array)
  } else if (length === undefined) {
    array = new Uint8Array(array, byteOffset)
  } else {
    array = new Uint8Array(array, byteOffset, length)
  }

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = array
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromArrayLike(that, array)
  }
  return that
}

function fromObject (that, obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    that = createBuffer(that, len)

    if (that.length === 0) {
      return that
    }

    obj.copy(that, 0, 0, len)
    return that
  }

  if (obj) {
    if ((typeof ArrayBuffer !== 'undefined' &&
        obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
      if (typeof obj.length !== 'number' || isnan(obj.length)) {
        return createBuffer(that, 0)
      }
      return fromArrayLike(that, obj)
    }

    if (obj.type === 'Buffer' && isArray(obj.data)) {
      return fromArrayLike(that, obj.data)
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
}

function checked (length) {
  // Note: cannot use `length < kMaxLength()` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
      (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string
  }

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
// Buffer instances.
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset  // Coerce to Number.
  if (isNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (Buffer.TYPED_ARRAY_SUPPORT &&
        typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = this.subarray(start, end)
    newBuf.__proto__ = Buffer.prototype
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; ++i) {
      newBuf[i] = this[i + start]
    }
  }

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; ++i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if (code < 256) {
        val = code
      }
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : utf8ToBytes(new Buffer(val, encoding).toString())
    var len = bytes.length
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function isnan (val) {
  return val !== val // eslint-disable-line no-self-compare
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":4,"ieee754":12,"isarray":15}],9:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.

function isArray(arg) {
  if (Array.isArray) {
    return Array.isArray(arg);
  }
  return objectToString(arg) === '[object Array]';
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = Buffer.isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

}).call(this,{"isBuffer":require("../../is-buffer/index.js")})
},{"../../is-buffer/index.js":14}],10:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        // At least give some kind of context to the user
        var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
        err.context = er;
        throw err;
      }
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    args = Array.prototype.slice.call(arguments, 1);
    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else if (listeners) {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.prototype.listenerCount = function(type) {
  if (this._events) {
    var evlistener = this._events[type];

    if (isFunction(evlistener))
      return 1;
    else if (evlistener)
      return evlistener.length;
  }
  return 0;
};

EventEmitter.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],11:[function(require,module,exports){
/*! Hammer.JS - v2.0.7 - 2016-04-22
 * http://hammerjs.github.io/
 *
 * Copyright (c) 2016 Jorik Tangelder;
 * Licensed under the MIT license */
(function(window, document, exportName, undefined) {
  'use strict';

var VENDOR_PREFIXES = ['', 'webkit', 'Moz', 'MS', 'ms', 'o'];
var TEST_ELEMENT = document.createElement('div');

var TYPE_FUNCTION = 'function';

var round = Math.round;
var abs = Math.abs;
var now = Date.now;

/**
 * set a timeout with a given scope
 * @param {Function} fn
 * @param {Number} timeout
 * @param {Object} context
 * @returns {number}
 */
function setTimeoutContext(fn, timeout, context) {
    return setTimeout(bindFn(fn, context), timeout);
}

/**
 * if the argument is an array, we want to execute the fn on each entry
 * if it aint an array we don't want to do a thing.
 * this is used by all the methods that accept a single and array argument.
 * @param {*|Array} arg
 * @param {String} fn
 * @param {Object} [context]
 * @returns {Boolean}
 */
function invokeArrayArg(arg, fn, context) {
    if (Array.isArray(arg)) {
        each(arg, context[fn], context);
        return true;
    }
    return false;
}

/**
 * walk objects and arrays
 * @param {Object} obj
 * @param {Function} iterator
 * @param {Object} context
 */
function each(obj, iterator, context) {
    var i;

    if (!obj) {
        return;
    }

    if (obj.forEach) {
        obj.forEach(iterator, context);
    } else if (obj.length !== undefined) {
        i = 0;
        while (i < obj.length) {
            iterator.call(context, obj[i], i, obj);
            i++;
        }
    } else {
        for (i in obj) {
            obj.hasOwnProperty(i) && iterator.call(context, obj[i], i, obj);
        }
    }
}

/**
 * wrap a method with a deprecation warning and stack trace
 * @param {Function} method
 * @param {String} name
 * @param {String} message
 * @returns {Function} A new function wrapping the supplied method.
 */
function deprecate(method, name, message) {
    var deprecationMessage = 'DEPRECATED METHOD: ' + name + '\n' + message + ' AT \n';
    return function() {
        var e = new Error('get-stack-trace');
        var stack = e && e.stack ? e.stack.replace(/^[^\(]+?[\n$]/gm, '')
            .replace(/^\s+at\s+/gm, '')
            .replace(/^Object.<anonymous>\s*\(/gm, '{anonymous}()@') : 'Unknown Stack Trace';

        var log = window.console && (window.console.warn || window.console.log);
        if (log) {
            log.call(window.console, deprecationMessage, stack);
        }
        return method.apply(this, arguments);
    };
}

/**
 * extend object.
 * means that properties in dest will be overwritten by the ones in src.
 * @param {Object} target
 * @param {...Object} objects_to_assign
 * @returns {Object} target
 */
var assign;
if (typeof Object.assign !== 'function') {
    assign = function assign(target) {
        if (target === undefined || target === null) {
            throw new TypeError('Cannot convert undefined or null to object');
        }

        var output = Object(target);
        for (var index = 1; index < arguments.length; index++) {
            var source = arguments[index];
            if (source !== undefined && source !== null) {
                for (var nextKey in source) {
                    if (source.hasOwnProperty(nextKey)) {
                        output[nextKey] = source[nextKey];
                    }
                }
            }
        }
        return output;
    };
} else {
    assign = Object.assign;
}

/**
 * extend object.
 * means that properties in dest will be overwritten by the ones in src.
 * @param {Object} dest
 * @param {Object} src
 * @param {Boolean} [merge=false]
 * @returns {Object} dest
 */
var extend = deprecate(function extend(dest, src, merge) {
    var keys = Object.keys(src);
    var i = 0;
    while (i < keys.length) {
        if (!merge || (merge && dest[keys[i]] === undefined)) {
            dest[keys[i]] = src[keys[i]];
        }
        i++;
    }
    return dest;
}, 'extend', 'Use `assign`.');

/**
 * merge the values from src in the dest.
 * means that properties that exist in dest will not be overwritten by src
 * @param {Object} dest
 * @param {Object} src
 * @returns {Object} dest
 */
var merge = deprecate(function merge(dest, src) {
    return extend(dest, src, true);
}, 'merge', 'Use `assign`.');

/**
 * simple class inheritance
 * @param {Function} child
 * @param {Function} base
 * @param {Object} [properties]
 */
function inherit(child, base, properties) {
    var baseP = base.prototype,
        childP;

    childP = child.prototype = Object.create(baseP);
    childP.constructor = child;
    childP._super = baseP;

    if (properties) {
        assign(childP, properties);
    }
}

/**
 * simple function bind
 * @param {Function} fn
 * @param {Object} context
 * @returns {Function}
 */
function bindFn(fn, context) {
    return function boundFn() {
        return fn.apply(context, arguments);
    };
}

/**
 * let a boolean value also be a function that must return a boolean
 * this first item in args will be used as the context
 * @param {Boolean|Function} val
 * @param {Array} [args]
 * @returns {Boolean}
 */
function boolOrFn(val, args) {
    if (typeof val == TYPE_FUNCTION) {
        return val.apply(args ? args[0] || undefined : undefined, args);
    }
    return val;
}

/**
 * use the val2 when val1 is undefined
 * @param {*} val1
 * @param {*} val2
 * @returns {*}
 */
function ifUndefined(val1, val2) {
    return (val1 === undefined) ? val2 : val1;
}

/**
 * addEventListener with multiple events at once
 * @param {EventTarget} target
 * @param {String} types
 * @param {Function} handler
 */
function addEventListeners(target, types, handler) {
    each(splitStr(types), function(type) {
        target.addEventListener(type, handler, false);
    });
}

/**
 * removeEventListener with multiple events at once
 * @param {EventTarget} target
 * @param {String} types
 * @param {Function} handler
 */
function removeEventListeners(target, types, handler) {
    each(splitStr(types), function(type) {
        target.removeEventListener(type, handler, false);
    });
}

/**
 * find if a node is in the given parent
 * @method hasParent
 * @param {HTMLElement} node
 * @param {HTMLElement} parent
 * @return {Boolean} found
 */
function hasParent(node, parent) {
    while (node) {
        if (node == parent) {
            return true;
        }
        node = node.parentNode;
    }
    return false;
}

/**
 * small indexOf wrapper
 * @param {String} str
 * @param {String} find
 * @returns {Boolean} found
 */
function inStr(str, find) {
    return str.indexOf(find) > -1;
}

/**
 * split string on whitespace
 * @param {String} str
 * @returns {Array} words
 */
function splitStr(str) {
    return str.trim().split(/\s+/g);
}

/**
 * find if a array contains the object using indexOf or a simple polyFill
 * @param {Array} src
 * @param {String} find
 * @param {String} [findByKey]
 * @return {Boolean|Number} false when not found, or the index
 */
function inArray(src, find, findByKey) {
    if (src.indexOf && !findByKey) {
        return src.indexOf(find);
    } else {
        var i = 0;
        while (i < src.length) {
            if ((findByKey && src[i][findByKey] == find) || (!findByKey && src[i] === find)) {
                return i;
            }
            i++;
        }
        return -1;
    }
}

/**
 * convert array-like objects to real arrays
 * @param {Object} obj
 * @returns {Array}
 */
function toArray(obj) {
    return Array.prototype.slice.call(obj, 0);
}

/**
 * unique array with objects based on a key (like 'id') or just by the array's value
 * @param {Array} src [{id:1},{id:2},{id:1}]
 * @param {String} [key]
 * @param {Boolean} [sort=False]
 * @returns {Array} [{id:1},{id:2}]
 */
function uniqueArray(src, key, sort) {
    var results = [];
    var values = [];
    var i = 0;

    while (i < src.length) {
        var val = key ? src[i][key] : src[i];
        if (inArray(values, val) < 0) {
            results.push(src[i]);
        }
        values[i] = val;
        i++;
    }

    if (sort) {
        if (!key) {
            results = results.sort();
        } else {
            results = results.sort(function sortUniqueArray(a, b) {
                return a[key] > b[key];
            });
        }
    }

    return results;
}

/**
 * get the prefixed property
 * @param {Object} obj
 * @param {String} property
 * @returns {String|Undefined} prefixed
 */
function prefixed(obj, property) {
    var prefix, prop;
    var camelProp = property[0].toUpperCase() + property.slice(1);

    var i = 0;
    while (i < VENDOR_PREFIXES.length) {
        prefix = VENDOR_PREFIXES[i];
        prop = (prefix) ? prefix + camelProp : property;

        if (prop in obj) {
            return prop;
        }
        i++;
    }
    return undefined;
}

/**
 * get a unique id
 * @returns {number} uniqueId
 */
var _uniqueId = 1;
function uniqueId() {
    return _uniqueId++;
}

/**
 * get the window object of an element
 * @param {HTMLElement} element
 * @returns {DocumentView|Window}
 */
function getWindowForElement(element) {
    var doc = element.ownerDocument || element;
    return (doc.defaultView || doc.parentWindow || window);
}

var MOBILE_REGEX = /mobile|tablet|ip(ad|hone|od)|android/i;

var SUPPORT_TOUCH = ('ontouchstart' in window);
var SUPPORT_POINTER_EVENTS = prefixed(window, 'PointerEvent') !== undefined;
var SUPPORT_ONLY_TOUCH = SUPPORT_TOUCH && MOBILE_REGEX.test(navigator.userAgent);

var INPUT_TYPE_TOUCH = 'touch';
var INPUT_TYPE_PEN = 'pen';
var INPUT_TYPE_MOUSE = 'mouse';
var INPUT_TYPE_KINECT = 'kinect';

var COMPUTE_INTERVAL = 25;

var INPUT_START = 1;
var INPUT_MOVE = 2;
var INPUT_END = 4;
var INPUT_CANCEL = 8;

var DIRECTION_NONE = 1;
var DIRECTION_LEFT = 2;
var DIRECTION_RIGHT = 4;
var DIRECTION_UP = 8;
var DIRECTION_DOWN = 16;

var DIRECTION_HORIZONTAL = DIRECTION_LEFT | DIRECTION_RIGHT;
var DIRECTION_VERTICAL = DIRECTION_UP | DIRECTION_DOWN;
var DIRECTION_ALL = DIRECTION_HORIZONTAL | DIRECTION_VERTICAL;

var PROPS_XY = ['x', 'y'];
var PROPS_CLIENT_XY = ['clientX', 'clientY'];

/**
 * create new input type manager
 * @param {Manager} manager
 * @param {Function} callback
 * @returns {Input}
 * @constructor
 */
function Input(manager, callback) {
    var self = this;
    this.manager = manager;
    this.callback = callback;
    this.element = manager.element;
    this.target = manager.options.inputTarget;

    // smaller wrapper around the handler, for the scope and the enabled state of the manager,
    // so when disabled the input events are completely bypassed.
    this.domHandler = function(ev) {
        if (boolOrFn(manager.options.enable, [manager])) {
            self.handler(ev);
        }
    };

    this.init();

}

Input.prototype = {
    /**
     * should handle the inputEvent data and trigger the callback
     * @virtual
     */
    handler: function() { },

    /**
     * bind the events
     */
    init: function() {
        this.evEl && addEventListeners(this.element, this.evEl, this.domHandler);
        this.evTarget && addEventListeners(this.target, this.evTarget, this.domHandler);
        this.evWin && addEventListeners(getWindowForElement(this.element), this.evWin, this.domHandler);
    },

    /**
     * unbind the events
     */
    destroy: function() {
        this.evEl && removeEventListeners(this.element, this.evEl, this.domHandler);
        this.evTarget && removeEventListeners(this.target, this.evTarget, this.domHandler);
        this.evWin && removeEventListeners(getWindowForElement(this.element), this.evWin, this.domHandler);
    }
};

/**
 * create new input type manager
 * called by the Manager constructor
 * @param {Hammer} manager
 * @returns {Input}
 */
function createInputInstance(manager) {
    var Type;
    var inputClass = manager.options.inputClass;

    if (inputClass) {
        Type = inputClass;
    } else if (SUPPORT_POINTER_EVENTS) {
        Type = PointerEventInput;
    } else if (SUPPORT_ONLY_TOUCH) {
        Type = TouchInput;
    } else if (!SUPPORT_TOUCH) {
        Type = MouseInput;
    } else {
        Type = TouchMouseInput;
    }
    return new (Type)(manager, inputHandler);
}

/**
 * handle input events
 * @param {Manager} manager
 * @param {String} eventType
 * @param {Object} input
 */
function inputHandler(manager, eventType, input) {
    var pointersLen = input.pointers.length;
    var changedPointersLen = input.changedPointers.length;
    var isFirst = (eventType & INPUT_START && (pointersLen - changedPointersLen === 0));
    var isFinal = (eventType & (INPUT_END | INPUT_CANCEL) && (pointersLen - changedPointersLen === 0));

    input.isFirst = !!isFirst;
    input.isFinal = !!isFinal;

    if (isFirst) {
        manager.session = {};
    }

    // source event is the normalized value of the domEvents
    // like 'touchstart, mouseup, pointerdown'
    input.eventType = eventType;

    // compute scale, rotation etc
    computeInputData(manager, input);

    // emit secret event
    manager.emit('hammer.input', input);

    manager.recognize(input);
    manager.session.prevInput = input;
}

/**
 * extend the data with some usable properties like scale, rotate, velocity etc
 * @param {Object} manager
 * @param {Object} input
 */
function computeInputData(manager, input) {
    var session = manager.session;
    var pointers = input.pointers;
    var pointersLength = pointers.length;

    // store the first input to calculate the distance and direction
    if (!session.firstInput) {
        session.firstInput = simpleCloneInputData(input);
    }

    // to compute scale and rotation we need to store the multiple touches
    if (pointersLength > 1 && !session.firstMultiple) {
        session.firstMultiple = simpleCloneInputData(input);
    } else if (pointersLength === 1) {
        session.firstMultiple = false;
    }

    var firstInput = session.firstInput;
    var firstMultiple = session.firstMultiple;
    var offsetCenter = firstMultiple ? firstMultiple.center : firstInput.center;

    var center = input.center = getCenter(pointers);
    input.timeStamp = now();
    input.deltaTime = input.timeStamp - firstInput.timeStamp;

    input.angle = getAngle(offsetCenter, center);
    input.distance = getDistance(offsetCenter, center);

    computeDeltaXY(session, input);
    input.offsetDirection = getDirection(input.deltaX, input.deltaY);

    var overallVelocity = getVelocity(input.deltaTime, input.deltaX, input.deltaY);
    input.overallVelocityX = overallVelocity.x;
    input.overallVelocityY = overallVelocity.y;
    input.overallVelocity = (abs(overallVelocity.x) > abs(overallVelocity.y)) ? overallVelocity.x : overallVelocity.y;

    input.scale = firstMultiple ? getScale(firstMultiple.pointers, pointers) : 1;
    input.rotation = firstMultiple ? getRotation(firstMultiple.pointers, pointers) : 0;

    input.maxPointers = !session.prevInput ? input.pointers.length : ((input.pointers.length >
        session.prevInput.maxPointers) ? input.pointers.length : session.prevInput.maxPointers);

    computeIntervalInputData(session, input);

    // find the correct target
    var target = manager.element;
    if (hasParent(input.srcEvent.target, target)) {
        target = input.srcEvent.target;
    }
    input.target = target;
}

function computeDeltaXY(session, input) {
    var center = input.center;
    var offset = session.offsetDelta || {};
    var prevDelta = session.prevDelta || {};
    var prevInput = session.prevInput || {};

    if (input.eventType === INPUT_START || prevInput.eventType === INPUT_END) {
        prevDelta = session.prevDelta = {
            x: prevInput.deltaX || 0,
            y: prevInput.deltaY || 0
        };

        offset = session.offsetDelta = {
            x: center.x,
            y: center.y
        };
    }

    input.deltaX = prevDelta.x + (center.x - offset.x);
    input.deltaY = prevDelta.y + (center.y - offset.y);
}

/**
 * velocity is calculated every x ms
 * @param {Object} session
 * @param {Object} input
 */
function computeIntervalInputData(session, input) {
    var last = session.lastInterval || input,
        deltaTime = input.timeStamp - last.timeStamp,
        velocity, velocityX, velocityY, direction;

    if (input.eventType != INPUT_CANCEL && (deltaTime > COMPUTE_INTERVAL || last.velocity === undefined)) {
        var deltaX = input.deltaX - last.deltaX;
        var deltaY = input.deltaY - last.deltaY;

        var v = getVelocity(deltaTime, deltaX, deltaY);
        velocityX = v.x;
        velocityY = v.y;
        velocity = (abs(v.x) > abs(v.y)) ? v.x : v.y;
        direction = getDirection(deltaX, deltaY);

        session.lastInterval = input;
    } else {
        // use latest velocity info if it doesn't overtake a minimum period
        velocity = last.velocity;
        velocityX = last.velocityX;
        velocityY = last.velocityY;
        direction = last.direction;
    }

    input.velocity = velocity;
    input.velocityX = velocityX;
    input.velocityY = velocityY;
    input.direction = direction;
}

/**
 * create a simple clone from the input used for storage of firstInput and firstMultiple
 * @param {Object} input
 * @returns {Object} clonedInputData
 */
function simpleCloneInputData(input) {
    // make a simple copy of the pointers because we will get a reference if we don't
    // we only need clientXY for the calculations
    var pointers = [];
    var i = 0;
    while (i < input.pointers.length) {
        pointers[i] = {
            clientX: round(input.pointers[i].clientX),
            clientY: round(input.pointers[i].clientY)
        };
        i++;
    }

    return {
        timeStamp: now(),
        pointers: pointers,
        center: getCenter(pointers),
        deltaX: input.deltaX,
        deltaY: input.deltaY
    };
}

/**
 * get the center of all the pointers
 * @param {Array} pointers
 * @return {Object} center contains `x` and `y` properties
 */
function getCenter(pointers) {
    var pointersLength = pointers.length;

    // no need to loop when only one touch
    if (pointersLength === 1) {
        return {
            x: round(pointers[0].clientX),
            y: round(pointers[0].clientY)
        };
    }

    var x = 0, y = 0, i = 0;
    while (i < pointersLength) {
        x += pointers[i].clientX;
        y += pointers[i].clientY;
        i++;
    }

    return {
        x: round(x / pointersLength),
        y: round(y / pointersLength)
    };
}

/**
 * calculate the velocity between two points. unit is in px per ms.
 * @param {Number} deltaTime
 * @param {Number} x
 * @param {Number} y
 * @return {Object} velocity `x` and `y`
 */
function getVelocity(deltaTime, x, y) {
    return {
        x: x / deltaTime || 0,
        y: y / deltaTime || 0
    };
}

/**
 * get the direction between two points
 * @param {Number} x
 * @param {Number} y
 * @return {Number} direction
 */
function getDirection(x, y) {
    if (x === y) {
        return DIRECTION_NONE;
    }

    if (abs(x) >= abs(y)) {
        return x < 0 ? DIRECTION_LEFT : DIRECTION_RIGHT;
    }
    return y < 0 ? DIRECTION_UP : DIRECTION_DOWN;
}

/**
 * calculate the absolute distance between two points
 * @param {Object} p1 {x, y}
 * @param {Object} p2 {x, y}
 * @param {Array} [props] containing x and y keys
 * @return {Number} distance
 */
function getDistance(p1, p2, props) {
    if (!props) {
        props = PROPS_XY;
    }
    var x = p2[props[0]] - p1[props[0]],
        y = p2[props[1]] - p1[props[1]];

    return Math.sqrt((x * x) + (y * y));
}

/**
 * calculate the angle between two coordinates
 * @param {Object} p1
 * @param {Object} p2
 * @param {Array} [props] containing x and y keys
 * @return {Number} angle
 */
function getAngle(p1, p2, props) {
    if (!props) {
        props = PROPS_XY;
    }
    var x = p2[props[0]] - p1[props[0]],
        y = p2[props[1]] - p1[props[1]];
    return Math.atan2(y, x) * 180 / Math.PI;
}

/**
 * calculate the rotation degrees between two pointersets
 * @param {Array} start array of pointers
 * @param {Array} end array of pointers
 * @return {Number} rotation
 */
function getRotation(start, end) {
    return getAngle(end[1], end[0], PROPS_CLIENT_XY) + getAngle(start[1], start[0], PROPS_CLIENT_XY);
}

/**
 * calculate the scale factor between two pointersets
 * no scale is 1, and goes down to 0 when pinched together, and bigger when pinched out
 * @param {Array} start array of pointers
 * @param {Array} end array of pointers
 * @return {Number} scale
 */
function getScale(start, end) {
    return getDistance(end[0], end[1], PROPS_CLIENT_XY) / getDistance(start[0], start[1], PROPS_CLIENT_XY);
}

var MOUSE_INPUT_MAP = {
    mousedown: INPUT_START,
    mousemove: INPUT_MOVE,
    mouseup: INPUT_END
};

var MOUSE_ELEMENT_EVENTS = 'mousedown';
var MOUSE_WINDOW_EVENTS = 'mousemove mouseup';

/**
 * Mouse events input
 * @constructor
 * @extends Input
 */
function MouseInput() {
    this.evEl = MOUSE_ELEMENT_EVENTS;
    this.evWin = MOUSE_WINDOW_EVENTS;

    this.pressed = false; // mousedown state

    Input.apply(this, arguments);
}

inherit(MouseInput, Input, {
    /**
     * handle mouse events
     * @param {Object} ev
     */
    handler: function MEhandler(ev) {
        var eventType = MOUSE_INPUT_MAP[ev.type];

        // on start we want to have the left mouse button down
        if (eventType & INPUT_START && ev.button === 0) {
            this.pressed = true;
        }

        if (eventType & INPUT_MOVE && ev.which !== 1) {
            eventType = INPUT_END;
        }

        // mouse must be down
        if (!this.pressed) {
            return;
        }

        if (eventType & INPUT_END) {
            this.pressed = false;
        }

        this.callback(this.manager, eventType, {
            pointers: [ev],
            changedPointers: [ev],
            pointerType: INPUT_TYPE_MOUSE,
            srcEvent: ev
        });
    }
});

var POINTER_INPUT_MAP = {
    pointerdown: INPUT_START,
    pointermove: INPUT_MOVE,
    pointerup: INPUT_END,
    pointercancel: INPUT_CANCEL,
    pointerout: INPUT_CANCEL
};

// in IE10 the pointer types is defined as an enum
var IE10_POINTER_TYPE_ENUM = {
    2: INPUT_TYPE_TOUCH,
    3: INPUT_TYPE_PEN,
    4: INPUT_TYPE_MOUSE,
    5: INPUT_TYPE_KINECT // see https://twitter.com/jacobrossi/status/480596438489890816
};

var POINTER_ELEMENT_EVENTS = 'pointerdown';
var POINTER_WINDOW_EVENTS = 'pointermove pointerup pointercancel';

// IE10 has prefixed support, and case-sensitive
if (window.MSPointerEvent && !window.PointerEvent) {
    POINTER_ELEMENT_EVENTS = 'MSPointerDown';
    POINTER_WINDOW_EVENTS = 'MSPointerMove MSPointerUp MSPointerCancel';
}

/**
 * Pointer events input
 * @constructor
 * @extends Input
 */
function PointerEventInput() {
    this.evEl = POINTER_ELEMENT_EVENTS;
    this.evWin = POINTER_WINDOW_EVENTS;

    Input.apply(this, arguments);

    this.store = (this.manager.session.pointerEvents = []);
}

inherit(PointerEventInput, Input, {
    /**
     * handle mouse events
     * @param {Object} ev
     */
    handler: function PEhandler(ev) {
        var store = this.store;
        var removePointer = false;

        var eventTypeNormalized = ev.type.toLowerCase().replace('ms', '');
        var eventType = POINTER_INPUT_MAP[eventTypeNormalized];
        var pointerType = IE10_POINTER_TYPE_ENUM[ev.pointerType] || ev.pointerType;

        var isTouch = (pointerType == INPUT_TYPE_TOUCH);

        // get index of the event in the store
        var storeIndex = inArray(store, ev.pointerId, 'pointerId');

        // start and mouse must be down
        if (eventType & INPUT_START && (ev.button === 0 || isTouch)) {
            if (storeIndex < 0) {
                store.push(ev);
                storeIndex = store.length - 1;
            }
        } else if (eventType & (INPUT_END | INPUT_CANCEL)) {
            removePointer = true;
        }

        // it not found, so the pointer hasn't been down (so it's probably a hover)
        if (storeIndex < 0) {
            return;
        }

        // update the event in the store
        store[storeIndex] = ev;

        this.callback(this.manager, eventType, {
            pointers: store,
            changedPointers: [ev],
            pointerType: pointerType,
            srcEvent: ev
        });

        if (removePointer) {
            // remove from the store
            store.splice(storeIndex, 1);
        }
    }
});

var SINGLE_TOUCH_INPUT_MAP = {
    touchstart: INPUT_START,
    touchmove: INPUT_MOVE,
    touchend: INPUT_END,
    touchcancel: INPUT_CANCEL
};

var SINGLE_TOUCH_TARGET_EVENTS = 'touchstart';
var SINGLE_TOUCH_WINDOW_EVENTS = 'touchstart touchmove touchend touchcancel';

/**
 * Touch events input
 * @constructor
 * @extends Input
 */
function SingleTouchInput() {
    this.evTarget = SINGLE_TOUCH_TARGET_EVENTS;
    this.evWin = SINGLE_TOUCH_WINDOW_EVENTS;
    this.started = false;

    Input.apply(this, arguments);
}

inherit(SingleTouchInput, Input, {
    handler: function TEhandler(ev) {
        var type = SINGLE_TOUCH_INPUT_MAP[ev.type];

        // should we handle the touch events?
        if (type === INPUT_START) {
            this.started = true;
        }

        if (!this.started) {
            return;
        }

        var touches = normalizeSingleTouches.call(this, ev, type);

        // when done, reset the started state
        if (type & (INPUT_END | INPUT_CANCEL) && touches[0].length - touches[1].length === 0) {
            this.started = false;
        }

        this.callback(this.manager, type, {
            pointers: touches[0],
            changedPointers: touches[1],
            pointerType: INPUT_TYPE_TOUCH,
            srcEvent: ev
        });
    }
});

/**
 * @this {TouchInput}
 * @param {Object} ev
 * @param {Number} type flag
 * @returns {undefined|Array} [all, changed]
 */
function normalizeSingleTouches(ev, type) {
    var all = toArray(ev.touches);
    var changed = toArray(ev.changedTouches);

    if (type & (INPUT_END | INPUT_CANCEL)) {
        all = uniqueArray(all.concat(changed), 'identifier', true);
    }

    return [all, changed];
}

var TOUCH_INPUT_MAP = {
    touchstart: INPUT_START,
    touchmove: INPUT_MOVE,
    touchend: INPUT_END,
    touchcancel: INPUT_CANCEL
};

var TOUCH_TARGET_EVENTS = 'touchstart touchmove touchend touchcancel';

/**
 * Multi-user touch events input
 * @constructor
 * @extends Input
 */
function TouchInput() {
    this.evTarget = TOUCH_TARGET_EVENTS;
    this.targetIds = {};

    Input.apply(this, arguments);
}

inherit(TouchInput, Input, {
    handler: function MTEhandler(ev) {
        var type = TOUCH_INPUT_MAP[ev.type];
        var touches = getTouches.call(this, ev, type);
        if (!touches) {
            return;
        }

        this.callback(this.manager, type, {
            pointers: touches[0],
            changedPointers: touches[1],
            pointerType: INPUT_TYPE_TOUCH,
            srcEvent: ev
        });
    }
});

/**
 * @this {TouchInput}
 * @param {Object} ev
 * @param {Number} type flag
 * @returns {undefined|Array} [all, changed]
 */
function getTouches(ev, type) {
    var allTouches = toArray(ev.touches);
    var targetIds = this.targetIds;

    // when there is only one touch, the process can be simplified
    if (type & (INPUT_START | INPUT_MOVE) && allTouches.length === 1) {
        targetIds[allTouches[0].identifier] = true;
        return [allTouches, allTouches];
    }

    var i,
        targetTouches,
        changedTouches = toArray(ev.changedTouches),
        changedTargetTouches = [],
        target = this.target;

    // get target touches from touches
    targetTouches = allTouches.filter(function(touch) {
        return hasParent(touch.target, target);
    });

    // collect touches
    if (type === INPUT_START) {
        i = 0;
        while (i < targetTouches.length) {
            targetIds[targetTouches[i].identifier] = true;
            i++;
        }
    }

    // filter changed touches to only contain touches that exist in the collected target ids
    i = 0;
    while (i < changedTouches.length) {
        if (targetIds[changedTouches[i].identifier]) {
            changedTargetTouches.push(changedTouches[i]);
        }

        // cleanup removed touches
        if (type & (INPUT_END | INPUT_CANCEL)) {
            delete targetIds[changedTouches[i].identifier];
        }
        i++;
    }

    if (!changedTargetTouches.length) {
        return;
    }

    return [
        // merge targetTouches with changedTargetTouches so it contains ALL touches, including 'end' and 'cancel'
        uniqueArray(targetTouches.concat(changedTargetTouches), 'identifier', true),
        changedTargetTouches
    ];
}

/**
 * Combined touch and mouse input
 *
 * Touch has a higher priority then mouse, and while touching no mouse events are allowed.
 * This because touch devices also emit mouse events while doing a touch.
 *
 * @constructor
 * @extends Input
 */

var DEDUP_TIMEOUT = 2500;
var DEDUP_DISTANCE = 25;

function TouchMouseInput() {
    Input.apply(this, arguments);

    var handler = bindFn(this.handler, this);
    this.touch = new TouchInput(this.manager, handler);
    this.mouse = new MouseInput(this.manager, handler);

    this.primaryTouch = null;
    this.lastTouches = [];
}

inherit(TouchMouseInput, Input, {
    /**
     * handle mouse and touch events
     * @param {Hammer} manager
     * @param {String} inputEvent
     * @param {Object} inputData
     */
    handler: function TMEhandler(manager, inputEvent, inputData) {
        var isTouch = (inputData.pointerType == INPUT_TYPE_TOUCH),
            isMouse = (inputData.pointerType == INPUT_TYPE_MOUSE);

        if (isMouse && inputData.sourceCapabilities && inputData.sourceCapabilities.firesTouchEvents) {
            return;
        }

        // when we're in a touch event, record touches to  de-dupe synthetic mouse event
        if (isTouch) {
            recordTouches.call(this, inputEvent, inputData);
        } else if (isMouse && isSyntheticEvent.call(this, inputData)) {
            return;
        }

        this.callback(manager, inputEvent, inputData);
    },

    /**
     * remove the event listeners
     */
    destroy: function destroy() {
        this.touch.destroy();
        this.mouse.destroy();
    }
});

function recordTouches(eventType, eventData) {
    if (eventType & INPUT_START) {
        this.primaryTouch = eventData.changedPointers[0].identifier;
        setLastTouch.call(this, eventData);
    } else if (eventType & (INPUT_END | INPUT_CANCEL)) {
        setLastTouch.call(this, eventData);
    }
}

function setLastTouch(eventData) {
    var touch = eventData.changedPointers[0];

    if (touch.identifier === this.primaryTouch) {
        var lastTouch = {x: touch.clientX, y: touch.clientY};
        this.lastTouches.push(lastTouch);
        var lts = this.lastTouches;
        var removeLastTouch = function() {
            var i = lts.indexOf(lastTouch);
            if (i > -1) {
                lts.splice(i, 1);
            }
        };
        setTimeout(removeLastTouch, DEDUP_TIMEOUT);
    }
}

function isSyntheticEvent(eventData) {
    var x = eventData.srcEvent.clientX, y = eventData.srcEvent.clientY;
    for (var i = 0; i < this.lastTouches.length; i++) {
        var t = this.lastTouches[i];
        var dx = Math.abs(x - t.x), dy = Math.abs(y - t.y);
        if (dx <= DEDUP_DISTANCE && dy <= DEDUP_DISTANCE) {
            return true;
        }
    }
    return false;
}

var PREFIXED_TOUCH_ACTION = prefixed(TEST_ELEMENT.style, 'touchAction');
var NATIVE_TOUCH_ACTION = PREFIXED_TOUCH_ACTION !== undefined;

// magical touchAction value
var TOUCH_ACTION_COMPUTE = 'compute';
var TOUCH_ACTION_AUTO = 'auto';
var TOUCH_ACTION_MANIPULATION = 'manipulation'; // not implemented
var TOUCH_ACTION_NONE = 'none';
var TOUCH_ACTION_PAN_X = 'pan-x';
var TOUCH_ACTION_PAN_Y = 'pan-y';
var TOUCH_ACTION_MAP = getTouchActionProps();

/**
 * Touch Action
 * sets the touchAction property or uses the js alternative
 * @param {Manager} manager
 * @param {String} value
 * @constructor
 */
function TouchAction(manager, value) {
    this.manager = manager;
    this.set(value);
}

TouchAction.prototype = {
    /**
     * set the touchAction value on the element or enable the polyfill
     * @param {String} value
     */
    set: function(value) {
        // find out the touch-action by the event handlers
        if (value == TOUCH_ACTION_COMPUTE) {
            value = this.compute();
        }

        if (NATIVE_TOUCH_ACTION && this.manager.element.style && TOUCH_ACTION_MAP[value]) {
            this.manager.element.style[PREFIXED_TOUCH_ACTION] = value;
        }
        this.actions = value.toLowerCase().trim();
    },

    /**
     * just re-set the touchAction value
     */
    update: function() {
        this.set(this.manager.options.touchAction);
    },

    /**
     * compute the value for the touchAction property based on the recognizer's settings
     * @returns {String} value
     */
    compute: function() {
        var actions = [];
        each(this.manager.recognizers, function(recognizer) {
            if (boolOrFn(recognizer.options.enable, [recognizer])) {
                actions = actions.concat(recognizer.getTouchAction());
            }
        });
        return cleanTouchActions(actions.join(' '));
    },

    /**
     * this method is called on each input cycle and provides the preventing of the browser behavior
     * @param {Object} input
     */
    preventDefaults: function(input) {
        var srcEvent = input.srcEvent;
        var direction = input.offsetDirection;

        // if the touch action did prevented once this session
        if (this.manager.session.prevented) {
            srcEvent.preventDefault();
            return;
        }

        var actions = this.actions;
        var hasNone = inStr(actions, TOUCH_ACTION_NONE) && !TOUCH_ACTION_MAP[TOUCH_ACTION_NONE];
        var hasPanY = inStr(actions, TOUCH_ACTION_PAN_Y) && !TOUCH_ACTION_MAP[TOUCH_ACTION_PAN_Y];
        var hasPanX = inStr(actions, TOUCH_ACTION_PAN_X) && !TOUCH_ACTION_MAP[TOUCH_ACTION_PAN_X];

        if (hasNone) {
            //do not prevent defaults if this is a tap gesture

            var isTapPointer = input.pointers.length === 1;
            var isTapMovement = input.distance < 2;
            var isTapTouchTime = input.deltaTime < 250;

            if (isTapPointer && isTapMovement && isTapTouchTime) {
                return;
            }
        }

        if (hasPanX && hasPanY) {
            // `pan-x pan-y` means browser handles all scrolling/panning, do not prevent
            return;
        }

        if (hasNone ||
            (hasPanY && direction & DIRECTION_HORIZONTAL) ||
            (hasPanX && direction & DIRECTION_VERTICAL)) {
            return this.preventSrc(srcEvent);
        }
    },

    /**
     * call preventDefault to prevent the browser's default behavior (scrolling in most cases)
     * @param {Object} srcEvent
     */
    preventSrc: function(srcEvent) {
        this.manager.session.prevented = true;
        srcEvent.preventDefault();
    }
};

/**
 * when the touchActions are collected they are not a valid value, so we need to clean things up. *
 * @param {String} actions
 * @returns {*}
 */
function cleanTouchActions(actions) {
    // none
    if (inStr(actions, TOUCH_ACTION_NONE)) {
        return TOUCH_ACTION_NONE;
    }

    var hasPanX = inStr(actions, TOUCH_ACTION_PAN_X);
    var hasPanY = inStr(actions, TOUCH_ACTION_PAN_Y);

    // if both pan-x and pan-y are set (different recognizers
    // for different directions, e.g. horizontal pan but vertical swipe?)
    // we need none (as otherwise with pan-x pan-y combined none of these
    // recognizers will work, since the browser would handle all panning
    if (hasPanX && hasPanY) {
        return TOUCH_ACTION_NONE;
    }

    // pan-x OR pan-y
    if (hasPanX || hasPanY) {
        return hasPanX ? TOUCH_ACTION_PAN_X : TOUCH_ACTION_PAN_Y;
    }

    // manipulation
    if (inStr(actions, TOUCH_ACTION_MANIPULATION)) {
        return TOUCH_ACTION_MANIPULATION;
    }

    return TOUCH_ACTION_AUTO;
}

function getTouchActionProps() {
    if (!NATIVE_TOUCH_ACTION) {
        return false;
    }
    var touchMap = {};
    var cssSupports = window.CSS && window.CSS.supports;
    ['auto', 'manipulation', 'pan-y', 'pan-x', 'pan-x pan-y', 'none'].forEach(function(val) {

        // If css.supports is not supported but there is native touch-action assume it supports
        // all values. This is the case for IE 10 and 11.
        touchMap[val] = cssSupports ? window.CSS.supports('touch-action', val) : true;
    });
    return touchMap;
}

/**
 * Recognizer flow explained; *
 * All recognizers have the initial state of POSSIBLE when a input session starts.
 * The definition of a input session is from the first input until the last input, with all it's movement in it. *
 * Example session for mouse-input: mousedown -> mousemove -> mouseup
 *
 * On each recognizing cycle (see Manager.recognize) the .recognize() method is executed
 * which determines with state it should be.
 *
 * If the recognizer has the state FAILED, CANCELLED or RECOGNIZED (equals ENDED), it is reset to
 * POSSIBLE to give it another change on the next cycle.
 *
 *               Possible
 *                  |
 *            +-----+---------------+
 *            |                     |
 *      +-----+-----+               |
 *      |           |               |
 *   Failed      Cancelled          |
 *                          +-------+------+
 *                          |              |
 *                      Recognized       Began
 *                                         |
 *                                      Changed
 *                                         |
 *                                  Ended/Recognized
 */
var STATE_POSSIBLE = 1;
var STATE_BEGAN = 2;
var STATE_CHANGED = 4;
var STATE_ENDED = 8;
var STATE_RECOGNIZED = STATE_ENDED;
var STATE_CANCELLED = 16;
var STATE_FAILED = 32;

/**
 * Recognizer
 * Every recognizer needs to extend from this class.
 * @constructor
 * @param {Object} options
 */
function Recognizer(options) {
    this.options = assign({}, this.defaults, options || {});

    this.id = uniqueId();

    this.manager = null;

    // default is enable true
    this.options.enable = ifUndefined(this.options.enable, true);

    this.state = STATE_POSSIBLE;

    this.simultaneous = {};
    this.requireFail = [];
}

Recognizer.prototype = {
    /**
     * @virtual
     * @type {Object}
     */
    defaults: {},

    /**
     * set options
     * @param {Object} options
     * @return {Recognizer}
     */
    set: function(options) {
        assign(this.options, options);

        // also update the touchAction, in case something changed about the directions/enabled state
        this.manager && this.manager.touchAction.update();
        return this;
    },

    /**
     * recognize simultaneous with an other recognizer.
     * @param {Recognizer} otherRecognizer
     * @returns {Recognizer} this
     */
    recognizeWith: function(otherRecognizer) {
        if (invokeArrayArg(otherRecognizer, 'recognizeWith', this)) {
            return this;
        }

        var simultaneous = this.simultaneous;
        otherRecognizer = getRecognizerByNameIfManager(otherRecognizer, this);
        if (!simultaneous[otherRecognizer.id]) {
            simultaneous[otherRecognizer.id] = otherRecognizer;
            otherRecognizer.recognizeWith(this);
        }
        return this;
    },

    /**
     * drop the simultaneous link. it doesnt remove the link on the other recognizer.
     * @param {Recognizer} otherRecognizer
     * @returns {Recognizer} this
     */
    dropRecognizeWith: function(otherRecognizer) {
        if (invokeArrayArg(otherRecognizer, 'dropRecognizeWith', this)) {
            return this;
        }

        otherRecognizer = getRecognizerByNameIfManager(otherRecognizer, this);
        delete this.simultaneous[otherRecognizer.id];
        return this;
    },

    /**
     * recognizer can only run when an other is failing
     * @param {Recognizer} otherRecognizer
     * @returns {Recognizer} this
     */
    requireFailure: function(otherRecognizer) {
        if (invokeArrayArg(otherRecognizer, 'requireFailure', this)) {
            return this;
        }

        var requireFail = this.requireFail;
        otherRecognizer = getRecognizerByNameIfManager(otherRecognizer, this);
        if (inArray(requireFail, otherRecognizer) === -1) {
            requireFail.push(otherRecognizer);
            otherRecognizer.requireFailure(this);
        }
        return this;
    },

    /**
     * drop the requireFailure link. it does not remove the link on the other recognizer.
     * @param {Recognizer} otherRecognizer
     * @returns {Recognizer} this
     */
    dropRequireFailure: function(otherRecognizer) {
        if (invokeArrayArg(otherRecognizer, 'dropRequireFailure', this)) {
            return this;
        }

        otherRecognizer = getRecognizerByNameIfManager(otherRecognizer, this);
        var index = inArray(this.requireFail, otherRecognizer);
        if (index > -1) {
            this.requireFail.splice(index, 1);
        }
        return this;
    },

    /**
     * has require failures boolean
     * @returns {boolean}
     */
    hasRequireFailures: function() {
        return this.requireFail.length > 0;
    },

    /**
     * if the recognizer can recognize simultaneous with an other recognizer
     * @param {Recognizer} otherRecognizer
     * @returns {Boolean}
     */
    canRecognizeWith: function(otherRecognizer) {
        return !!this.simultaneous[otherRecognizer.id];
    },

    /**
     * You should use `tryEmit` instead of `emit` directly to check
     * that all the needed recognizers has failed before emitting.
     * @param {Object} input
     */
    emit: function(input) {
        var self = this;
        var state = this.state;

        function emit(event) {
            self.manager.emit(event, input);
        }

        // 'panstart' and 'panmove'
        if (state < STATE_ENDED) {
            emit(self.options.event + stateStr(state));
        }

        emit(self.options.event); // simple 'eventName' events

        if (input.additionalEvent) { // additional event(panleft, panright, pinchin, pinchout...)
            emit(input.additionalEvent);
        }

        // panend and pancancel
        if (state >= STATE_ENDED) {
            emit(self.options.event + stateStr(state));
        }
    },

    /**
     * Check that all the require failure recognizers has failed,
     * if true, it emits a gesture event,
     * otherwise, setup the state to FAILED.
     * @param {Object} input
     */
    tryEmit: function(input) {
        if (this.canEmit()) {
            return this.emit(input);
        }
        // it's failing anyway
        this.state = STATE_FAILED;
    },

    /**
     * can we emit?
     * @returns {boolean}
     */
    canEmit: function() {
        var i = 0;
        while (i < this.requireFail.length) {
            if (!(this.requireFail[i].state & (STATE_FAILED | STATE_POSSIBLE))) {
                return false;
            }
            i++;
        }
        return true;
    },

    /**
     * update the recognizer
     * @param {Object} inputData
     */
    recognize: function(inputData) {
        // make a new copy of the inputData
        // so we can change the inputData without messing up the other recognizers
        var inputDataClone = assign({}, inputData);

        // is is enabled and allow recognizing?
        if (!boolOrFn(this.options.enable, [this, inputDataClone])) {
            this.reset();
            this.state = STATE_FAILED;
            return;
        }

        // reset when we've reached the end
        if (this.state & (STATE_RECOGNIZED | STATE_CANCELLED | STATE_FAILED)) {
            this.state = STATE_POSSIBLE;
        }

        this.state = this.process(inputDataClone);

        // the recognizer has recognized a gesture
        // so trigger an event
        if (this.state & (STATE_BEGAN | STATE_CHANGED | STATE_ENDED | STATE_CANCELLED)) {
            this.tryEmit(inputDataClone);
        }
    },

    /**
     * return the state of the recognizer
     * the actual recognizing happens in this method
     * @virtual
     * @param {Object} inputData
     * @returns {Const} STATE
     */
    process: function(inputData) { }, // jshint ignore:line

    /**
     * return the preferred touch-action
     * @virtual
     * @returns {Array}
     */
    getTouchAction: function() { },

    /**
     * called when the gesture isn't allowed to recognize
     * like when another is being recognized or it is disabled
     * @virtual
     */
    reset: function() { }
};

/**
 * get a usable string, used as event postfix
 * @param {Const} state
 * @returns {String} state
 */
function stateStr(state) {
    if (state & STATE_CANCELLED) {
        return 'cancel';
    } else if (state & STATE_ENDED) {
        return 'end';
    } else if (state & STATE_CHANGED) {
        return 'move';
    } else if (state & STATE_BEGAN) {
        return 'start';
    }
    return '';
}

/**
 * direction cons to string
 * @param {Const} direction
 * @returns {String}
 */
function directionStr(direction) {
    if (direction == DIRECTION_DOWN) {
        return 'down';
    } else if (direction == DIRECTION_UP) {
        return 'up';
    } else if (direction == DIRECTION_LEFT) {
        return 'left';
    } else if (direction == DIRECTION_RIGHT) {
        return 'right';
    }
    return '';
}

/**
 * get a recognizer by name if it is bound to a manager
 * @param {Recognizer|String} otherRecognizer
 * @param {Recognizer} recognizer
 * @returns {Recognizer}
 */
function getRecognizerByNameIfManager(otherRecognizer, recognizer) {
    var manager = recognizer.manager;
    if (manager) {
        return manager.get(otherRecognizer);
    }
    return otherRecognizer;
}

/**
 * This recognizer is just used as a base for the simple attribute recognizers.
 * @constructor
 * @extends Recognizer
 */
function AttrRecognizer() {
    Recognizer.apply(this, arguments);
}

inherit(AttrRecognizer, Recognizer, {
    /**
     * @namespace
     * @memberof AttrRecognizer
     */
    defaults: {
        /**
         * @type {Number}
         * @default 1
         */
        pointers: 1
    },

    /**
     * Used to check if it the recognizer receives valid input, like input.distance > 10.
     * @memberof AttrRecognizer
     * @param {Object} input
     * @returns {Boolean} recognized
     */
    attrTest: function(input) {
        var optionPointers = this.options.pointers;
        return optionPointers === 0 || input.pointers.length === optionPointers;
    },

    /**
     * Process the input and return the state for the recognizer
     * @memberof AttrRecognizer
     * @param {Object} input
     * @returns {*} State
     */
    process: function(input) {
        var state = this.state;
        var eventType = input.eventType;

        var isRecognized = state & (STATE_BEGAN | STATE_CHANGED);
        var isValid = this.attrTest(input);

        // on cancel input and we've recognized before, return STATE_CANCELLED
        if (isRecognized && (eventType & INPUT_CANCEL || !isValid)) {
            return state | STATE_CANCELLED;
        } else if (isRecognized || isValid) {
            if (eventType & INPUT_END) {
                return state | STATE_ENDED;
            } else if (!(state & STATE_BEGAN)) {
                return STATE_BEGAN;
            }
            return state | STATE_CHANGED;
        }
        return STATE_FAILED;
    }
});

/**
 * Pan
 * Recognized when the pointer is down and moved in the allowed direction.
 * @constructor
 * @extends AttrRecognizer
 */
function PanRecognizer() {
    AttrRecognizer.apply(this, arguments);

    this.pX = null;
    this.pY = null;
}

inherit(PanRecognizer, AttrRecognizer, {
    /**
     * @namespace
     * @memberof PanRecognizer
     */
    defaults: {
        event: 'pan',
        threshold: 10,
        pointers: 1,
        direction: DIRECTION_ALL
    },

    getTouchAction: function() {
        var direction = this.options.direction;
        var actions = [];
        if (direction & DIRECTION_HORIZONTAL) {
            actions.push(TOUCH_ACTION_PAN_Y);
        }
        if (direction & DIRECTION_VERTICAL) {
            actions.push(TOUCH_ACTION_PAN_X);
        }
        return actions;
    },

    directionTest: function(input) {
        var options = this.options;
        var hasMoved = true;
        var distance = input.distance;
        var direction = input.direction;
        var x = input.deltaX;
        var y = input.deltaY;

        // lock to axis?
        if (!(direction & options.direction)) {
            if (options.direction & DIRECTION_HORIZONTAL) {
                direction = (x === 0) ? DIRECTION_NONE : (x < 0) ? DIRECTION_LEFT : DIRECTION_RIGHT;
                hasMoved = x != this.pX;
                distance = Math.abs(input.deltaX);
            } else {
                direction = (y === 0) ? DIRECTION_NONE : (y < 0) ? DIRECTION_UP : DIRECTION_DOWN;
                hasMoved = y != this.pY;
                distance = Math.abs(input.deltaY);
            }
        }
        input.direction = direction;
        return hasMoved && distance > options.threshold && direction & options.direction;
    },

    attrTest: function(input) {
        return AttrRecognizer.prototype.attrTest.call(this, input) &&
            (this.state & STATE_BEGAN || (!(this.state & STATE_BEGAN) && this.directionTest(input)));
    },

    emit: function(input) {

        this.pX = input.deltaX;
        this.pY = input.deltaY;

        var direction = directionStr(input.direction);

        if (direction) {
            input.additionalEvent = this.options.event + direction;
        }
        this._super.emit.call(this, input);
    }
});

/**
 * Pinch
 * Recognized when two or more pointers are moving toward (zoom-in) or away from each other (zoom-out).
 * @constructor
 * @extends AttrRecognizer
 */
function PinchRecognizer() {
    AttrRecognizer.apply(this, arguments);
}

inherit(PinchRecognizer, AttrRecognizer, {
    /**
     * @namespace
     * @memberof PinchRecognizer
     */
    defaults: {
        event: 'pinch',
        threshold: 0,
        pointers: 2
    },

    getTouchAction: function() {
        return [TOUCH_ACTION_NONE];
    },

    attrTest: function(input) {
        return this._super.attrTest.call(this, input) &&
            (Math.abs(input.scale - 1) > this.options.threshold || this.state & STATE_BEGAN);
    },

    emit: function(input) {
        if (input.scale !== 1) {
            var inOut = input.scale < 1 ? 'in' : 'out';
            input.additionalEvent = this.options.event + inOut;
        }
        this._super.emit.call(this, input);
    }
});

/**
 * Press
 * Recognized when the pointer is down for x ms without any movement.
 * @constructor
 * @extends Recognizer
 */
function PressRecognizer() {
    Recognizer.apply(this, arguments);

    this._timer = null;
    this._input = null;
}

inherit(PressRecognizer, Recognizer, {
    /**
     * @namespace
     * @memberof PressRecognizer
     */
    defaults: {
        event: 'press',
        pointers: 1,
        time: 251, // minimal time of the pointer to be pressed
        threshold: 9 // a minimal movement is ok, but keep it low
    },

    getTouchAction: function() {
        return [TOUCH_ACTION_AUTO];
    },

    process: function(input) {
        var options = this.options;
        var validPointers = input.pointers.length === options.pointers;
        var validMovement = input.distance < options.threshold;
        var validTime = input.deltaTime > options.time;

        this._input = input;

        // we only allow little movement
        // and we've reached an end event, so a tap is possible
        if (!validMovement || !validPointers || (input.eventType & (INPUT_END | INPUT_CANCEL) && !validTime)) {
            this.reset();
        } else if (input.eventType & INPUT_START) {
            this.reset();
            this._timer = setTimeoutContext(function() {
                this.state = STATE_RECOGNIZED;
                this.tryEmit();
            }, options.time, this);
        } else if (input.eventType & INPUT_END) {
            return STATE_RECOGNIZED;
        }
        return STATE_FAILED;
    },

    reset: function() {
        clearTimeout(this._timer);
    },

    emit: function(input) {
        if (this.state !== STATE_RECOGNIZED) {
            return;
        }

        if (input && (input.eventType & INPUT_END)) {
            this.manager.emit(this.options.event + 'up', input);
        } else {
            this._input.timeStamp = now();
            this.manager.emit(this.options.event, this._input);
        }
    }
});

/**
 * Rotate
 * Recognized when two or more pointer are moving in a circular motion.
 * @constructor
 * @extends AttrRecognizer
 */
function RotateRecognizer() {
    AttrRecognizer.apply(this, arguments);
}

inherit(RotateRecognizer, AttrRecognizer, {
    /**
     * @namespace
     * @memberof RotateRecognizer
     */
    defaults: {
        event: 'rotate',
        threshold: 0,
        pointers: 2
    },

    getTouchAction: function() {
        return [TOUCH_ACTION_NONE];
    },

    attrTest: function(input) {
        return this._super.attrTest.call(this, input) &&
            (Math.abs(input.rotation) > this.options.threshold || this.state & STATE_BEGAN);
    }
});

/**
 * Swipe
 * Recognized when the pointer is moving fast (velocity), with enough distance in the allowed direction.
 * @constructor
 * @extends AttrRecognizer
 */
function SwipeRecognizer() {
    AttrRecognizer.apply(this, arguments);
}

inherit(SwipeRecognizer, AttrRecognizer, {
    /**
     * @namespace
     * @memberof SwipeRecognizer
     */
    defaults: {
        event: 'swipe',
        threshold: 10,
        velocity: 0.3,
        direction: DIRECTION_HORIZONTAL | DIRECTION_VERTICAL,
        pointers: 1
    },

    getTouchAction: function() {
        return PanRecognizer.prototype.getTouchAction.call(this);
    },

    attrTest: function(input) {
        var direction = this.options.direction;
        var velocity;

        if (direction & (DIRECTION_HORIZONTAL | DIRECTION_VERTICAL)) {
            velocity = input.overallVelocity;
        } else if (direction & DIRECTION_HORIZONTAL) {
            velocity = input.overallVelocityX;
        } else if (direction & DIRECTION_VERTICAL) {
            velocity = input.overallVelocityY;
        }

        return this._super.attrTest.call(this, input) &&
            direction & input.offsetDirection &&
            input.distance > this.options.threshold &&
            input.maxPointers == this.options.pointers &&
            abs(velocity) > this.options.velocity && input.eventType & INPUT_END;
    },

    emit: function(input) {
        var direction = directionStr(input.offsetDirection);
        if (direction) {
            this.manager.emit(this.options.event + direction, input);
        }

        this.manager.emit(this.options.event, input);
    }
});

/**
 * A tap is ecognized when the pointer is doing a small tap/click. Multiple taps are recognized if they occur
 * between the given interval and position. The delay option can be used to recognize multi-taps without firing
 * a single tap.
 *
 * The eventData from the emitted event contains the property `tapCount`, which contains the amount of
 * multi-taps being recognized.
 * @constructor
 * @extends Recognizer
 */
function TapRecognizer() {
    Recognizer.apply(this, arguments);

    // previous time and center,
    // used for tap counting
    this.pTime = false;
    this.pCenter = false;

    this._timer = null;
    this._input = null;
    this.count = 0;
}

inherit(TapRecognizer, Recognizer, {
    /**
     * @namespace
     * @memberof PinchRecognizer
     */
    defaults: {
        event: 'tap',
        pointers: 1,
        taps: 1,
        interval: 300, // max time between the multi-tap taps
        time: 250, // max time of the pointer to be down (like finger on the screen)
        threshold: 9, // a minimal movement is ok, but keep it low
        posThreshold: 10 // a multi-tap can be a bit off the initial position
    },

    getTouchAction: function() {
        return [TOUCH_ACTION_MANIPULATION];
    },

    process: function(input) {
        var options = this.options;

        var validPointers = input.pointers.length === options.pointers;
        var validMovement = input.distance < options.threshold;
        var validTouchTime = input.deltaTime < options.time;

        this.reset();

        if ((input.eventType & INPUT_START) && (this.count === 0)) {
            return this.failTimeout();
        }

        // we only allow little movement
        // and we've reached an end event, so a tap is possible
        if (validMovement && validTouchTime && validPointers) {
            if (input.eventType != INPUT_END) {
                return this.failTimeout();
            }

            var validInterval = this.pTime ? (input.timeStamp - this.pTime < options.interval) : true;
            var validMultiTap = !this.pCenter || getDistance(this.pCenter, input.center) < options.posThreshold;

            this.pTime = input.timeStamp;
            this.pCenter = input.center;

            if (!validMultiTap || !validInterval) {
                this.count = 1;
            } else {
                this.count += 1;
            }

            this._input = input;

            // if tap count matches we have recognized it,
            // else it has began recognizing...
            var tapCount = this.count % options.taps;
            if (tapCount === 0) {
                // no failing requirements, immediately trigger the tap event
                // or wait as long as the multitap interval to trigger
                if (!this.hasRequireFailures()) {
                    return STATE_RECOGNIZED;
                } else {
                    this._timer = setTimeoutContext(function() {
                        this.state = STATE_RECOGNIZED;
                        this.tryEmit();
                    }, options.interval, this);
                    return STATE_BEGAN;
                }
            }
        }
        return STATE_FAILED;
    },

    failTimeout: function() {
        this._timer = setTimeoutContext(function() {
            this.state = STATE_FAILED;
        }, this.options.interval, this);
        return STATE_FAILED;
    },

    reset: function() {
        clearTimeout(this._timer);
    },

    emit: function() {
        if (this.state == STATE_RECOGNIZED) {
            this._input.tapCount = this.count;
            this.manager.emit(this.options.event, this._input);
        }
    }
});

/**
 * Simple way to create a manager with a default set of recognizers.
 * @param {HTMLElement} element
 * @param {Object} [options]
 * @constructor
 */
function Hammer(element, options) {
    options = options || {};
    options.recognizers = ifUndefined(options.recognizers, Hammer.defaults.preset);
    return new Manager(element, options);
}

/**
 * @const {string}
 */
Hammer.VERSION = '2.0.7';

/**
 * default settings
 * @namespace
 */
Hammer.defaults = {
    /**
     * set if DOM events are being triggered.
     * But this is slower and unused by simple implementations, so disabled by default.
     * @type {Boolean}
     * @default false
     */
    domEvents: false,

    /**
     * The value for the touchAction property/fallback.
     * When set to `compute` it will magically set the correct value based on the added recognizers.
     * @type {String}
     * @default compute
     */
    touchAction: TOUCH_ACTION_COMPUTE,

    /**
     * @type {Boolean}
     * @default true
     */
    enable: true,

    /**
     * EXPERIMENTAL FEATURE -- can be removed/changed
     * Change the parent input target element.
     * If Null, then it is being set the to main element.
     * @type {Null|EventTarget}
     * @default null
     */
    inputTarget: null,

    /**
     * force an input class
     * @type {Null|Function}
     * @default null
     */
    inputClass: null,

    /**
     * Default recognizer setup when calling `Hammer()`
     * When creating a new Manager these will be skipped.
     * @type {Array}
     */
    preset: [
        // RecognizerClass, options, [recognizeWith, ...], [requireFailure, ...]
        [RotateRecognizer, {enable: false}],
        [PinchRecognizer, {enable: false}, ['rotate']],
        [SwipeRecognizer, {direction: DIRECTION_HORIZONTAL}],
        [PanRecognizer, {direction: DIRECTION_HORIZONTAL}, ['swipe']],
        [TapRecognizer],
        [TapRecognizer, {event: 'doubletap', taps: 2}, ['tap']],
        [PressRecognizer]
    ],

    /**
     * Some CSS properties can be used to improve the working of Hammer.
     * Add them to this method and they will be set when creating a new Manager.
     * @namespace
     */
    cssProps: {
        /**
         * Disables text selection to improve the dragging gesture. Mainly for desktop browsers.
         * @type {String}
         * @default 'none'
         */
        userSelect: 'none',

        /**
         * Disable the Windows Phone grippers when pressing an element.
         * @type {String}
         * @default 'none'
         */
        touchSelect: 'none',

        /**
         * Disables the default callout shown when you touch and hold a touch target.
         * On iOS, when you touch and hold a touch target such as a link, Safari displays
         * a callout containing information about the link. This property allows you to disable that callout.
         * @type {String}
         * @default 'none'
         */
        touchCallout: 'none',

        /**
         * Specifies whether zooming is enabled. Used by IE10>
         * @type {String}
         * @default 'none'
         */
        contentZooming: 'none',

        /**
         * Specifies that an entire element should be draggable instead of its contents. Mainly for desktop browsers.
         * @type {String}
         * @default 'none'
         */
        userDrag: 'none',

        /**
         * Overrides the highlight color shown when the user taps a link or a JavaScript
         * clickable element in iOS. This property obeys the alpha value, if specified.
         * @type {String}
         * @default 'rgba(0,0,0,0)'
         */
        tapHighlightColor: 'rgba(0,0,0,0)'
    }
};

var STOP = 1;
var FORCED_STOP = 2;

/**
 * Manager
 * @param {HTMLElement} element
 * @param {Object} [options]
 * @constructor
 */
function Manager(element, options) {
    this.options = assign({}, Hammer.defaults, options || {});

    this.options.inputTarget = this.options.inputTarget || element;

    this.handlers = {};
    this.session = {};
    this.recognizers = [];
    this.oldCssProps = {};

    this.element = element;
    this.input = createInputInstance(this);
    this.touchAction = new TouchAction(this, this.options.touchAction);

    toggleCssProps(this, true);

    each(this.options.recognizers, function(item) {
        var recognizer = this.add(new (item[0])(item[1]));
        item[2] && recognizer.recognizeWith(item[2]);
        item[3] && recognizer.requireFailure(item[3]);
    }, this);
}

Manager.prototype = {
    /**
     * set options
     * @param {Object} options
     * @returns {Manager}
     */
    set: function(options) {
        assign(this.options, options);

        // Options that need a little more setup
        if (options.touchAction) {
            this.touchAction.update();
        }
        if (options.inputTarget) {
            // Clean up existing event listeners and reinitialize
            this.input.destroy();
            this.input.target = options.inputTarget;
            this.input.init();
        }
        return this;
    },

    /**
     * stop recognizing for this session.
     * This session will be discarded, when a new [input]start event is fired.
     * When forced, the recognizer cycle is stopped immediately.
     * @param {Boolean} [force]
     */
    stop: function(force) {
        this.session.stopped = force ? FORCED_STOP : STOP;
    },

    /**
     * run the recognizers!
     * called by the inputHandler function on every movement of the pointers (touches)
     * it walks through all the recognizers and tries to detect the gesture that is being made
     * @param {Object} inputData
     */
    recognize: function(inputData) {
        var session = this.session;
        if (session.stopped) {
            return;
        }

        // run the touch-action polyfill
        this.touchAction.preventDefaults(inputData);

        var recognizer;
        var recognizers = this.recognizers;

        // this holds the recognizer that is being recognized.
        // so the recognizer's state needs to be BEGAN, CHANGED, ENDED or RECOGNIZED
        // if no recognizer is detecting a thing, it is set to `null`
        var curRecognizer = session.curRecognizer;

        // reset when the last recognizer is recognized
        // or when we're in a new session
        if (!curRecognizer || (curRecognizer && curRecognizer.state & STATE_RECOGNIZED)) {
            curRecognizer = session.curRecognizer = null;
        }

        var i = 0;
        while (i < recognizers.length) {
            recognizer = recognizers[i];

            // find out if we are allowed try to recognize the input for this one.
            // 1.   allow if the session is NOT forced stopped (see the .stop() method)
            // 2.   allow if we still haven't recognized a gesture in this session, or the this recognizer is the one
            //      that is being recognized.
            // 3.   allow if the recognizer is allowed to run simultaneous with the current recognized recognizer.
            //      this can be setup with the `recognizeWith()` method on the recognizer.
            if (session.stopped !== FORCED_STOP && ( // 1
                    !curRecognizer || recognizer == curRecognizer || // 2
                    recognizer.canRecognizeWith(curRecognizer))) { // 3
                recognizer.recognize(inputData);
            } else {
                recognizer.reset();
            }

            // if the recognizer has been recognizing the input as a valid gesture, we want to store this one as the
            // current active recognizer. but only if we don't already have an active recognizer
            if (!curRecognizer && recognizer.state & (STATE_BEGAN | STATE_CHANGED | STATE_ENDED)) {
                curRecognizer = session.curRecognizer = recognizer;
            }
            i++;
        }
    },

    /**
     * get a recognizer by its event name.
     * @param {Recognizer|String} recognizer
     * @returns {Recognizer|Null}
     */
    get: function(recognizer) {
        if (recognizer instanceof Recognizer) {
            return recognizer;
        }

        var recognizers = this.recognizers;
        for (var i = 0; i < recognizers.length; i++) {
            if (recognizers[i].options.event == recognizer) {
                return recognizers[i];
            }
        }
        return null;
    },

    /**
     * add a recognizer to the manager
     * existing recognizers with the same event name will be removed
     * @param {Recognizer} recognizer
     * @returns {Recognizer|Manager}
     */
    add: function(recognizer) {
        if (invokeArrayArg(recognizer, 'add', this)) {
            return this;
        }

        // remove existing
        var existing = this.get(recognizer.options.event);
        if (existing) {
            this.remove(existing);
        }

        this.recognizers.push(recognizer);
        recognizer.manager = this;

        this.touchAction.update();
        return recognizer;
    },

    /**
     * remove a recognizer by name or instance
     * @param {Recognizer|String} recognizer
     * @returns {Manager}
     */
    remove: function(recognizer) {
        if (invokeArrayArg(recognizer, 'remove', this)) {
            return this;
        }

        recognizer = this.get(recognizer);

        // let's make sure this recognizer exists
        if (recognizer) {
            var recognizers = this.recognizers;
            var index = inArray(recognizers, recognizer);

            if (index !== -1) {
                recognizers.splice(index, 1);
                this.touchAction.update();
            }
        }

        return this;
    },

    /**
     * bind event
     * @param {String} events
     * @param {Function} handler
     * @returns {EventEmitter} this
     */
    on: function(events, handler) {
        if (events === undefined) {
            return;
        }
        if (handler === undefined) {
            return;
        }

        var handlers = this.handlers;
        each(splitStr(events), function(event) {
            handlers[event] = handlers[event] || [];
            handlers[event].push(handler);
        });
        return this;
    },

    /**
     * unbind event, leave emit blank to remove all handlers
     * @param {String} events
     * @param {Function} [handler]
     * @returns {EventEmitter} this
     */
    off: function(events, handler) {
        if (events === undefined) {
            return;
        }

        var handlers = this.handlers;
        each(splitStr(events), function(event) {
            if (!handler) {
                delete handlers[event];
            } else {
                handlers[event] && handlers[event].splice(inArray(handlers[event], handler), 1);
            }
        });
        return this;
    },

    /**
     * emit event to the listeners
     * @param {String} event
     * @param {Object} data
     */
    emit: function(event, data) {
        // we also want to trigger dom events
        if (this.options.domEvents) {
            triggerDomEvent(event, data);
        }

        // no handlers, so skip it all
        var handlers = this.handlers[event] && this.handlers[event].slice();
        if (!handlers || !handlers.length) {
            return;
        }

        data.type = event;
        data.preventDefault = function() {
            data.srcEvent.preventDefault();
        };

        var i = 0;
        while (i < handlers.length) {
            handlers[i](data);
            i++;
        }
    },

    /**
     * destroy the manager and unbinds all events
     * it doesn't unbind dom events, that is the user own responsibility
     */
    destroy: function() {
        this.element && toggleCssProps(this, false);

        this.handlers = {};
        this.session = {};
        this.input.destroy();
        this.element = null;
    }
};

/**
 * add/remove the css properties as defined in manager.options.cssProps
 * @param {Manager} manager
 * @param {Boolean} add
 */
function toggleCssProps(manager, add) {
    var element = manager.element;
    if (!element.style) {
        return;
    }
    var prop;
    each(manager.options.cssProps, function(value, name) {
        prop = prefixed(element.style, name);
        if (add) {
            manager.oldCssProps[prop] = element.style[prop];
            element.style[prop] = value;
        } else {
            element.style[prop] = manager.oldCssProps[prop] || '';
        }
    });
    if (!add) {
        manager.oldCssProps = {};
    }
}

/**
 * trigger dom event
 * @param {String} event
 * @param {Object} data
 */
function triggerDomEvent(event, data) {
    var gestureEvent = document.createEvent('Event');
    gestureEvent.initEvent(event, true, true);
    gestureEvent.gesture = data;
    data.target.dispatchEvent(gestureEvent);
}

assign(Hammer, {
    INPUT_START: INPUT_START,
    INPUT_MOVE: INPUT_MOVE,
    INPUT_END: INPUT_END,
    INPUT_CANCEL: INPUT_CANCEL,

    STATE_POSSIBLE: STATE_POSSIBLE,
    STATE_BEGAN: STATE_BEGAN,
    STATE_CHANGED: STATE_CHANGED,
    STATE_ENDED: STATE_ENDED,
    STATE_RECOGNIZED: STATE_RECOGNIZED,
    STATE_CANCELLED: STATE_CANCELLED,
    STATE_FAILED: STATE_FAILED,

    DIRECTION_NONE: DIRECTION_NONE,
    DIRECTION_LEFT: DIRECTION_LEFT,
    DIRECTION_RIGHT: DIRECTION_RIGHT,
    DIRECTION_UP: DIRECTION_UP,
    DIRECTION_DOWN: DIRECTION_DOWN,
    DIRECTION_HORIZONTAL: DIRECTION_HORIZONTAL,
    DIRECTION_VERTICAL: DIRECTION_VERTICAL,
    DIRECTION_ALL: DIRECTION_ALL,

    Manager: Manager,
    Input: Input,
    TouchAction: TouchAction,

    TouchInput: TouchInput,
    MouseInput: MouseInput,
    PointerEventInput: PointerEventInput,
    TouchMouseInput: TouchMouseInput,
    SingleTouchInput: SingleTouchInput,

    Recognizer: Recognizer,
    AttrRecognizer: AttrRecognizer,
    Tap: TapRecognizer,
    Pan: PanRecognizer,
    Swipe: SwipeRecognizer,
    Pinch: PinchRecognizer,
    Rotate: RotateRecognizer,
    Press: PressRecognizer,

    on: addEventListeners,
    off: removeEventListeners,
    each: each,
    merge: merge,
    extend: extend,
    assign: assign,
    inherit: inherit,
    bindFn: bindFn,
    prefixed: prefixed
});

// this prevents errors when Hammer is loaded in the presence of an AMD
//  style loader but by script tag, not by the loader.
var freeGlobal = (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : {})); // jshint ignore:line
freeGlobal.Hammer = Hammer;

if (typeof define === 'function' && define.amd) {
    define(function() {
        return Hammer;
    });
} else if (typeof module != 'undefined' && module.exports) {
    module.exports = Hammer;
} else {
    window[exportName] = Hammer;
}

})(window, document, 'Hammer');

},{}],12:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],13:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],14:[function(require,module,exports){
/*!
 * Determine if an object is a Buffer
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

// The _isBuffer check is for Safari 5-7 support, because it's missing
// Object.prototype.constructor. Remove this eventually
module.exports = function (obj) {
  return obj != null && (isBuffer(obj) || isSlowBuffer(obj) || !!obj._isBuffer)
}

function isBuffer (obj) {
  return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
}

// For Node v0.10 support. Remove this eventually.
function isSlowBuffer (obj) {
  return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isBuffer(obj.slice(0, 0))
}

},{}],15:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],16:[function(require,module,exports){
(function (process){
'use strict';

if (!process.version ||
    process.version.indexOf('v0.') === 0 ||
    process.version.indexOf('v1.') === 0 && process.version.indexOf('v1.8.') !== 0) {
  module.exports = nextTick;
} else {
  module.exports = process.nextTick;
}

function nextTick(fn, arg1, arg2, arg3) {
  if (typeof fn !== 'function') {
    throw new TypeError('"callback" argument must be a function');
  }
  var len = arguments.length;
  var args, i;
  switch (len) {
  case 0:
  case 1:
    return process.nextTick(fn);
  case 2:
    return process.nextTick(function afterTickOne() {
      fn.call(null, arg1);
    });
  case 3:
    return process.nextTick(function afterTickTwo() {
      fn.call(null, arg1, arg2);
    });
  case 4:
    return process.nextTick(function afterTickThree() {
      fn.call(null, arg1, arg2, arg3);
    });
  default:
    args = new Array(len - 1);
    i = 0;
    while (i < args.length) {
      args[i++] = arguments[i];
    }
    return process.nextTick(function afterTick() {
      fn.apply(null, args);
    });
  }
}

}).call(this,require('_process'))
},{"_process":17}],17:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],18:[function(require,module,exports){
module.exports = require('./lib/_stream_duplex.js');

},{"./lib/_stream_duplex.js":19}],19:[function(require,module,exports){
// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

'use strict';

/*<replacement>*/

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    keys.push(key);
  }return keys;
};
/*</replacement>*/

module.exports = Duplex;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

var keys = objectKeys(Writable.prototype);
for (var v = 0; v < keys.length; v++) {
  var method = keys[v];
  if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
}

function Duplex(options) {
  if (!(this instanceof Duplex)) return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false) this.readable = false;

  if (options && options.writable === false) this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended) return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  processNextTick(onEndNT, this);
}

function onEndNT(self) {
  self.end();
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}
},{"./_stream_readable":21,"./_stream_writable":23,"core-util-is":9,"inherits":13,"process-nextick-args":16}],20:[function(require,module,exports){
// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

'use strict';

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough)) return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function (chunk, encoding, cb) {
  cb(null, chunk);
};
},{"./_stream_transform":22,"core-util-is":9,"inherits":13}],21:[function(require,module,exports){
(function (process){
'use strict';

module.exports = Readable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/

/*<replacement>*/
var Duplex;
/*</replacement>*/

Readable.ReadableState = ReadableState;

/*<replacement>*/
var EE = require('events').EventEmitter;

var EElistenerCount = function (emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

/*<replacement>*/
var Stream = require('./internal/streams/stream');
/*</replacement>*/

var Buffer = require('buffer').Buffer;
/*<replacement>*/
var bufferShim = require('buffer-shims');
/*</replacement>*/

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var debugUtil = require('util');
var debug = void 0;
if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/

var BufferList = require('./internal/streams/BufferList');
var StringDecoder;

util.inherits(Readable, Stream);

var kProxyEvents = ['error', 'close', 'destroy', 'pause', 'resume'];

function prependListener(emitter, event, fn) {
  // Sadly this is not cacheable as some libraries bundle their own
  // event emitter implementation with them.
  if (typeof emitter.prependListener === 'function') {
    return emitter.prependListener(event, fn);
  } else {
    // This is a hack to make sure that our error handler is attached before any
    // userland ones.  NEVER DO THIS. This is here only because this code needs
    // to continue to work with older versions of Node.js that do not include
    // the prependListener() method. The goal is to eventually remove this hack.
    if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);else if (isArray(emitter._events[event])) emitter._events[event].unshift(fn);else emitter._events[event] = [fn, emitter._events[event]];
  }
}

function ReadableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.readableObjectMode;

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  // A linked list is used to store data chunks instead of an array because the
  // linked list can remove elements from the beginning faster than
  // array.shift()
  this.buffer = new BufferList();
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  if (!(this instanceof Readable)) return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  if (options && typeof options.read === 'function') this._read = options.read;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function (chunk, encoding) {
  var state = this._readableState;

  if (!state.objectMode && typeof chunk === 'string') {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = bufferShim.from(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function (chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

Readable.prototype.isPaused = function () {
  return this._readableState.flowing === false;
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var _e = new Error('stream.unshift() after end event');
      stream.emit('error', _e);
    } else {
      var skipAdd;
      if (state.decoder && !addToFront && !encoding) {
        chunk = state.decoder.write(chunk);
        skipAdd = !state.objectMode && chunk.length === 0;
      }

      if (!addToFront) state.reading = false;

      // Don't add to the buffer if we've decoded to an empty string chunk and
      // we're not in object mode
      if (!skipAdd) {
        // if we want the data now, just emit it.
        if (state.flowing && state.length === 0 && !state.sync) {
          stream.emit('data', chunk);
          stream.read(0);
        } else {
          // update the buffer info.
          state.length += state.objectMode ? 1 : chunk.length;
          if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);

          if (state.needReadable) emitReadable(stream);
        }
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}

// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function (enc) {
  if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 8MB
var MAX_HWM = 0x800000;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2 to prevent increasing hwm excessively in
    // tiny amounts
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function howMuchToRead(n, state) {
  if (n <= 0 || state.length === 0 && state.ended) return 0;
  if (state.objectMode) return 1;
  if (n !== n) {
    // Only flow one buffer at a time
    if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
  }
  // If we're asking for more than the current hwm, then raise the hwm.
  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
  if (n <= state.length) return n;
  // Don't have enough
  if (!state.ended) {
    state.needReadable = true;
    return 0;
  }
  return state.length;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function (n) {
  debug('read', n);
  n = parseInt(n, 10);
  var state = this._readableState;
  var nOrig = n;

  if (n !== 0) state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0) endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  } else if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
    // If _read pushed data synchronously, then `reading` will be false,
    // and we need to re-evaluate how much data we can return to the user.
    if (!state.reading) n = howMuchToRead(nOrig, state);
  }

  var ret;
  if (n > 0) ret = fromList(n, state);else ret = null;

  if (ret === null) {
    state.needReadable = true;
    n = 0;
  } else {
    state.length -= n;
  }

  if (state.length === 0) {
    // If we have nothing in the buffer, then we want to know
    // as soon as we *do* get something into the buffer.
    if (!state.ended) state.needReadable = true;

    // If we tried to read() past the EOF, then emit end on the next tick.
    if (nOrig !== n && state.ended) endReadable(this);
  }

  if (ret !== null) this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}

function onEofChunk(stream, state) {
  if (state.ended) return;
  if (state.decoder) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync) processNextTick(emitReadable_, stream);else emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}

// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    processNextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;else len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function (n) {
  this.emit('error', new Error('_read() is not implemented'));
};

Readable.prototype.pipe = function (dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted) processNextTick(endFn);else src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  var cleanedUp = false;
  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    cleanedUp = true;

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  // If the user pushes more data while we're writing to dest then we'll end up
  // in ondata again. However, we only want to increase awaitDrain once because
  // dest will only emit one 'drain' event for the multiple writes.
  // => Introduce a guard on increasing awaitDrain.
  var increasedAwaitDrain = false;
  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    increasedAwaitDrain = false;
    var ret = dest.write(chunk);
    if (false === ret && !increasedAwaitDrain) {
      // If the user unpiped during `dest.write()`, it is possible
      // to get stuck in a permanently paused state if that write
      // also returned false.
      // => Check whether `dest` is still a piping destination.
      if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
        debug('false write response, pause', src._readableState.awaitDrain);
        src._readableState.awaitDrain++;
        increasedAwaitDrain = true;
      }
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EElistenerCount(dest, 'error') === 0) dest.emit('error', er);
  }

  // Make sure our error handler is attached before userland ones.
  prependListener(dest, 'error', onerror);

  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function () {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain) state.awaitDrain--;
    if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}

Readable.prototype.unpipe = function (dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0) return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes) return this;

    if (!dest) dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest) dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++) {
      dests[i].emit('unpipe', this);
    }return this;
  }

  // try to find the right one.
  var index = indexOf(state.pipes, dest);
  if (index === -1) return this;

  state.pipes.splice(index, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1) state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function (ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  if (ev === 'data') {
    // Start flowing on next tick if stream isn't explicitly paused
    if (this._readableState.flowing !== false) this.resume();
  } else if (ev === 'readable') {
    var state = this._readableState;
    if (!state.endEmitted && !state.readableListening) {
      state.readableListening = state.needReadable = true;
      state.emittedReadable = false;
      if (!state.reading) {
        processNextTick(nReadingNextTick, this);
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

function nReadingNextTick(self) {
  debug('readable nexttick read 0');
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function () {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    processNextTick(resume_, stream, state);
  }
}

function resume_(stream, state) {
  if (!state.reading) {
    debug('resume read 0');
    stream.read(0);
  }

  state.resumeScheduled = false;
  state.awaitDrain = 0;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

Readable.prototype.pause = function () {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  while (state.flowing && stream.read() !== null) {}
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function (stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function () {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length) self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function (chunk) {
    debug('wrapped data');
    if (state.decoder) chunk = state.decoder.write(chunk);

    // don't skip over falsy values in objectMode
    if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (this[i] === undefined && typeof stream[i] === 'function') {
      this[i] = function (method) {
        return function () {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  }

  // proxy certain important events.
  for (var n = 0; n < kProxyEvents.length; n++) {
    stream.on(kProxyEvents[n], self.emit.bind(self, kProxyEvents[n]));
  }

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function (n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};

// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromList(n, state) {
  // nothing buffered
  if (state.length === 0) return null;

  var ret;
  if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
    // read it all, truncate the list
    if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.head.data;else ret = state.buffer.concat(state.length);
    state.buffer.clear();
  } else {
    // read part of list
    ret = fromListPartial(n, state.buffer, state.decoder);
  }

  return ret;
}

// Extracts only enough buffered data to satisfy the amount requested.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromListPartial(n, list, hasStrings) {
  var ret;
  if (n < list.head.data.length) {
    // slice is the same for buffers and strings
    ret = list.head.data.slice(0, n);
    list.head.data = list.head.data.slice(n);
  } else if (n === list.head.data.length) {
    // first chunk is a perfect match
    ret = list.shift();
  } else {
    // result spans more than one buffer
    ret = hasStrings ? copyFromBufferString(n, list) : copyFromBuffer(n, list);
  }
  return ret;
}

// Copies a specified amount of characters from the list of buffered data
// chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBufferString(n, list) {
  var p = list.head;
  var c = 1;
  var ret = p.data;
  n -= ret.length;
  while (p = p.next) {
    var str = p.data;
    var nb = n > str.length ? str.length : n;
    if (nb === str.length) ret += str;else ret += str.slice(0, n);
    n -= nb;
    if (n === 0) {
      if (nb === str.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = str.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

// Copies a specified amount of bytes from the list of buffered data chunks.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function copyFromBuffer(n, list) {
  var ret = bufferShim.allocUnsafe(n);
  var p = list.head;
  var c = 1;
  p.data.copy(ret);
  n -= p.data.length;
  while (p = p.next) {
    var buf = p.data;
    var nb = n > buf.length ? buf.length : n;
    buf.copy(ret, ret.length - n, 0, nb);
    n -= nb;
    if (n === 0) {
      if (nb === buf.length) {
        ++c;
        if (p.next) list.head = p.next;else list.head = list.tail = null;
      } else {
        list.head = p;
        p.data = buf.slice(nb);
      }
      break;
    }
    ++c;
  }
  list.length -= c;
  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0) throw new Error('"endReadable()" called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    processNextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state, stream) {
  // Check that we didn't get one last unshift.
  if (!state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.readable = false;
    stream.emit('end');
  }
}

function forEach(xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}
}).call(this,require('_process'))
},{"./_stream_duplex":19,"./internal/streams/BufferList":24,"./internal/streams/stream":25,"_process":17,"buffer":8,"buffer-shims":7,"core-util-is":9,"events":10,"inherits":13,"isarray":15,"process-nextick-args":16,"string_decoder/":32,"util":5}],22:[function(require,module,exports){
// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

'use strict';

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);

function TransformState(stream) {
  this.afterTransform = function (er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
  this.writeencoding = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb) return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (data !== null && data !== undefined) stream.push(data);

  cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}

function Transform(options) {
  if (!(this instanceof Transform)) return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(this);

  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  if (options) {
    if (typeof options.transform === 'function') this._transform = options.transform;

    if (typeof options.flush === 'function') this._flush = options.flush;
  }

  // When the writable side finishes, then flush out anything remaining.
  this.once('prefinish', function () {
    if (typeof this._flush === 'function') this._flush(function (er, data) {
      done(stream, er, data);
    });else done(stream);
  });
}

Transform.prototype.push = function (chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function (chunk, encoding, cb) {
  throw new Error('_transform() is not implemented');
};

Transform.prototype._write = function (chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function (n) {
  var ts = this._transformState;

  if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};

function done(stream, er, data) {
  if (er) return stream.emit('error', er);

  if (data !== null && data !== undefined) stream.push(data);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length) throw new Error('Calling transform done when ws.length != 0');

  if (ts.transforming) throw new Error('Calling transform done when still transforming');

  return stream.push(null);
}
},{"./_stream_duplex":19,"core-util-is":9,"inherits":13}],23:[function(require,module,exports){
(function (process){
// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

'use strict';

module.exports = Writable;

/*<replacement>*/
var processNextTick = require('process-nextick-args');
/*</replacement>*/

/*<replacement>*/
var asyncWrite = !process.browser && ['v0.10', 'v0.9.'].indexOf(process.version.slice(0, 5)) > -1 ? setImmediate : processNextTick;
/*</replacement>*/

/*<replacement>*/
var Duplex;
/*</replacement>*/

Writable.WritableState = WritableState;

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

/*<replacement>*/
var internalUtil = {
  deprecate: require('util-deprecate')
};
/*</replacement>*/

/*<replacement>*/
var Stream = require('./internal/streams/stream');
/*</replacement>*/

var Buffer = require('buffer').Buffer;
/*<replacement>*/
var bufferShim = require('buffer-shims');
/*</replacement>*/

util.inherits(Writable, Stream);

function nop() {}

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
  this.next = null;
}

function WritableState(options, stream) {
  Duplex = Duplex || require('./_stream_duplex');

  options = options || {};

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.writableObjectMode;

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = this.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  // drain event flag.
  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function (er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.bufferedRequest = null;
  this.lastBufferedRequest = null;

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;

  // count buffered requests
  this.bufferedRequestCount = 0;

  // allocate the first CorkedRequest, there is always
  // one allocated and free to use, and we maintain at most two
  this.corkedRequestsFree = new CorkedRequest(this);
}

WritableState.prototype.getBuffer = function getBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};

(function () {
  try {
    Object.defineProperty(WritableState.prototype, 'buffer', {
      get: internalUtil.deprecate(function () {
        return this.getBuffer();
      }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.')
    });
  } catch (_) {}
})();

// Test _writableState for inheritance to account for Duplex streams,
// whose prototype chain only points to Readable.
var realHasInstance;
if (typeof Symbol === 'function' && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === 'function') {
  realHasInstance = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Writable, Symbol.hasInstance, {
    value: function (object) {
      if (realHasInstance.call(this, object)) return true;

      return object && object._writableState instanceof WritableState;
    }
  });
} else {
  realHasInstance = function (object) {
    return object instanceof this;
  };
}

function Writable(options) {
  Duplex = Duplex || require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, too.
  // `realHasInstance` is necessary because using plain `instanceof`
  // would return false, as no `_writableState` property is attached.

  // Trying to use the custom `instanceof` for Writable here will also break the
  // Node.js LazyTransform implementation, which has a non-trivial getter for
  // `_writableState` that would lead to infinite recursion.
  if (!realHasInstance.call(Writable, this) && !(this instanceof Duplex)) {
    return new Writable(options);
  }

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  if (options) {
    if (typeof options.write === 'function') this._write = options.write;

    if (typeof options.writev === 'function') this._writev = options.writev;
  }

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function () {
  this.emit('error', new Error('Cannot pipe, not readable'));
};

function writeAfterEnd(stream, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  processNextTick(cb, er);
}

// Checks that a user-supplied chunk is valid, especially for the particular
// mode the stream is in. Currently this means that `null` is never accepted
// and undefined/non-string values are only allowed in object mode.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  var er = false;

  if (chunk === null) {
    er = new TypeError('May not write null values to stream');
  } else if (typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  if (er) {
    stream.emit('error', er);
    processNextTick(cb, er);
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function (chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;
  var isBuf = Buffer.isBuffer(chunk);

  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (isBuf) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;

  if (typeof cb !== 'function') cb = nop;

  if (state.ended) writeAfterEnd(this, cb);else if (isBuf || validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function () {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function () {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === 'string') encoding = encoding.toLowerCase();
  if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new TypeError('Unknown encoding: ' + encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
    chunk = bufferShim.from(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
  if (!isBuf) {
    chunk = decodeChunk(state, chunk, encoding);
    if (Buffer.isBuffer(chunk)) encoding = 'buffer';
  }
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret) state.needDrain = true;

  if (state.writing || state.corked) {
    var last = state.lastBufferedRequest;
    state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
    if (last) {
      last.next = state.lastBufferedRequest;
    } else {
      state.bufferedRequest = state.lastBufferedRequest;
    }
    state.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state, false, len, chunk, encoding, cb);
  }

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  --state.pendingcb;
  if (sync) processNextTick(cb, er);else cb(er);

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er) onwriteError(stream, state, sync, er, cb);else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(state);

    if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
      clearBuffer(stream, state);
    }

    if (sync) {
      /*<replacement>*/
      asyncWrite(afterWrite, stream, state, finished, cb);
      /*</replacement>*/
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished) onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}

// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;
  var entry = state.bufferedRequest;

  if (stream._writev && entry && entry.next) {
    // Fast case, write everything using _writev()
    var l = state.bufferedRequestCount;
    var buffer = new Array(l);
    var holder = state.corkedRequestsFree;
    holder.entry = entry;

    var count = 0;
    while (entry) {
      buffer[count] = entry;
      entry = entry.next;
      count += 1;
    }

    doWrite(stream, state, true, state.length, buffer, '', holder.finish);

    // doWrite is almost always async, defer these to save a bit of time
    // as the hot path ends with doWrite
    state.pendingcb++;
    state.lastBufferedRequest = null;
    if (holder.next) {
      state.corkedRequestsFree = holder.next;
      holder.next = null;
    } else {
      state.corkedRequestsFree = new CorkedRequest(state);
    }
  } else {
    // Slow case, write chunks one-by-one
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);
      entry = entry.next;
      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        break;
      }
    }

    if (entry === null) state.lastBufferedRequest = null;
  }

  state.bufferedRequestCount = 0;
  state.bufferedRequest = entry;
  state.bufferProcessing = false;
}

Writable.prototype._write = function (chunk, encoding, cb) {
  cb(new Error('_write() is not implemented'));
};

Writable.prototype._writev = null;

Writable.prototype.end = function (chunk, encoding, cb) {
  var state = this._writableState;

  if (typeof chunk === 'function') {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === 'function') {
    cb = encoding;
    encoding = null;
  }

  if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished) endWritable(this, state, cb);
};

function needFinish(state) {
  return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else {
      prefinish(stream, state);
    }
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished) processNextTick(cb);else stream.once('finish', cb);
  }
  state.ended = true;
  stream.writable = false;
}

// It seems a linked list but it is not
// there will be only 2 of these for each stream
function CorkedRequest(state) {
  var _this = this;

  this.next = null;
  this.entry = null;
  this.finish = function (err) {
    var entry = _this.entry;
    _this.entry = null;
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    }
    if (state.corkedRequestsFree) {
      state.corkedRequestsFree.next = _this;
    } else {
      state.corkedRequestsFree = _this;
    }
  };
}
}).call(this,require('_process'))
},{"./_stream_duplex":19,"./internal/streams/stream":25,"_process":17,"buffer":8,"buffer-shims":7,"core-util-is":9,"inherits":13,"process-nextick-args":16,"util-deprecate":33}],24:[function(require,module,exports){
'use strict';

var Buffer = require('buffer').Buffer;
/*<replacement>*/
var bufferShim = require('buffer-shims');
/*</replacement>*/

module.exports = BufferList;

function BufferList() {
  this.head = null;
  this.tail = null;
  this.length = 0;
}

BufferList.prototype.push = function (v) {
  var entry = { data: v, next: null };
  if (this.length > 0) this.tail.next = entry;else this.head = entry;
  this.tail = entry;
  ++this.length;
};

BufferList.prototype.unshift = function (v) {
  var entry = { data: v, next: this.head };
  if (this.length === 0) this.tail = entry;
  this.head = entry;
  ++this.length;
};

BufferList.prototype.shift = function () {
  if (this.length === 0) return;
  var ret = this.head.data;
  if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
  --this.length;
  return ret;
};

BufferList.prototype.clear = function () {
  this.head = this.tail = null;
  this.length = 0;
};

BufferList.prototype.join = function (s) {
  if (this.length === 0) return '';
  var p = this.head;
  var ret = '' + p.data;
  while (p = p.next) {
    ret += s + p.data;
  }return ret;
};

BufferList.prototype.concat = function (n) {
  if (this.length === 0) return bufferShim.alloc(0);
  if (this.length === 1) return this.head.data;
  var ret = bufferShim.allocUnsafe(n >>> 0);
  var p = this.head;
  var i = 0;
  while (p) {
    p.data.copy(ret, i);
    i += p.data.length;
    p = p.next;
  }
  return ret;
};
},{"buffer":8,"buffer-shims":7}],25:[function(require,module,exports){
module.exports = require('events').EventEmitter;

},{"events":10}],26:[function(require,module,exports){
module.exports = require('./readable').PassThrough

},{"./readable":27}],27:[function(require,module,exports){
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = exports;
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":19,"./lib/_stream_passthrough.js":20,"./lib/_stream_readable.js":21,"./lib/_stream_transform.js":22,"./lib/_stream_writable.js":23}],28:[function(require,module,exports){
module.exports = require('./readable').Transform

},{"./readable":27}],29:[function(require,module,exports){
module.exports = require('./lib/_stream_writable.js');

},{"./lib/_stream_writable.js":23}],30:[function(require,module,exports){
(function (Buffer){
;(function (sax) { // wrapper for non-node envs
  sax.parser = function (strict, opt) { return new SAXParser(strict, opt) }
  sax.SAXParser = SAXParser
  sax.SAXStream = SAXStream
  sax.createStream = createStream

  // When we pass the MAX_BUFFER_LENGTH position, start checking for buffer overruns.
  // When we check, schedule the next check for MAX_BUFFER_LENGTH - (max(buffer lengths)),
  // since that's the earliest that a buffer overrun could occur.  This way, checks are
  // as rare as required, but as often as necessary to ensure never crossing this bound.
  // Furthermore, buffers are only tested at most once per write(), so passing a very
  // large string into write() might have undesirable effects, but this is manageable by
  // the caller, so it is assumed to be safe.  Thus, a call to write() may, in the extreme
  // edge case, result in creating at most one complete copy of the string passed in.
  // Set to Infinity to have unlimited buffers.
  sax.MAX_BUFFER_LENGTH = 64 * 1024

  var buffers = [
    'comment', 'sgmlDecl', 'textNode', 'tagName', 'doctype',
    'procInstName', 'procInstBody', 'entity', 'attribName',
    'attribValue', 'cdata', 'script'
  ]

  sax.EVENTS = [
    'text',
    'processinginstruction',
    'sgmldeclaration',
    'doctype',
    'comment',
    'opentagstart',
    'attribute',
    'opentag',
    'closetag',
    'opencdata',
    'cdata',
    'closecdata',
    'error',
    'end',
    'ready',
    'script',
    'opennamespace',
    'closenamespace'
  ]

  function SAXParser (strict, opt) {
    if (!(this instanceof SAXParser)) {
      return new SAXParser(strict, opt)
    }

    var parser = this
    clearBuffers(parser)
    parser.q = parser.c = ''
    parser.bufferCheckPosition = sax.MAX_BUFFER_LENGTH
    parser.opt = opt || {}
    parser.opt.lowercase = parser.opt.lowercase || parser.opt.lowercasetags
    parser.looseCase = parser.opt.lowercase ? 'toLowerCase' : 'toUpperCase'
    parser.tags = []
    parser.closed = parser.closedRoot = parser.sawRoot = false
    parser.tag = parser.error = null
    parser.strict = !!strict
    parser.noscript = !!(strict || parser.opt.noscript)
    parser.state = S.BEGIN
    parser.strictEntities = parser.opt.strictEntities
    parser.ENTITIES = parser.strictEntities ? Object.create(sax.XML_ENTITIES) : Object.create(sax.ENTITIES)
    parser.attribList = []

    // namespaces form a prototype chain.
    // it always points at the current tag,
    // which protos to its parent tag.
    if (parser.opt.xmlns) {
      parser.ns = Object.create(rootNS)
    }

    // mostly just for error reporting
    parser.trackPosition = parser.opt.position !== false
    if (parser.trackPosition) {
      parser.position = parser.line = parser.column = 0
    }
    emit(parser, 'onready')
  }

  if (!Object.create) {
    Object.create = function (o) {
      function F () {}
      F.prototype = o
      var newf = new F()
      return newf
    }
  }

  if (!Object.keys) {
    Object.keys = function (o) {
      var a = []
      for (var i in o) if (o.hasOwnProperty(i)) a.push(i)
      return a
    }
  }

  function checkBufferLength (parser) {
    var maxAllowed = Math.max(sax.MAX_BUFFER_LENGTH, 10)
    var maxActual = 0
    for (var i = 0, l = buffers.length; i < l; i++) {
      var len = parser[buffers[i]].length
      if (len > maxAllowed) {
        // Text/cdata nodes can get big, and since they're buffered,
        // we can get here under normal conditions.
        // Avoid issues by emitting the text node now,
        // so at least it won't get any bigger.
        switch (buffers[i]) {
          case 'textNode':
            closeText(parser)
            break

          case 'cdata':
            emitNode(parser, 'oncdata', parser.cdata)
            parser.cdata = ''
            break

          case 'script':
            emitNode(parser, 'onscript', parser.script)
            parser.script = ''
            break

          default:
            error(parser, 'Max buffer length exceeded: ' + buffers[i])
        }
      }
      maxActual = Math.max(maxActual, len)
    }
    // schedule the next check for the earliest possible buffer overrun.
    var m = sax.MAX_BUFFER_LENGTH - maxActual
    parser.bufferCheckPosition = m + parser.position
  }

  function clearBuffers (parser) {
    for (var i = 0, l = buffers.length; i < l; i++) {
      parser[buffers[i]] = ''
    }
  }

  function flushBuffers (parser) {
    closeText(parser)
    if (parser.cdata !== '') {
      emitNode(parser, 'oncdata', parser.cdata)
      parser.cdata = ''
    }
    if (parser.script !== '') {
      emitNode(parser, 'onscript', parser.script)
      parser.script = ''
    }
  }

  SAXParser.prototype = {
    end: function () { end(this) },
    write: write,
    resume: function () { this.error = null; return this },
    close: function () { return this.write(null) },
    flush: function () { flushBuffers(this) }
  }

  var Stream
  try {
    Stream = require('stream').Stream
  } catch (ex) {
    Stream = function () {}
  }

  var streamWraps = sax.EVENTS.filter(function (ev) {
    return ev !== 'error' && ev !== 'end'
  })

  function createStream (strict, opt) {
    return new SAXStream(strict, opt)
  }

  function SAXStream (strict, opt) {
    if (!(this instanceof SAXStream)) {
      return new SAXStream(strict, opt)
    }

    Stream.apply(this)

    this._parser = new SAXParser(strict, opt)
    this.writable = true
    this.readable = true

    var me = this

    this._parser.onend = function () {
      me.emit('end')
    }

    this._parser.onerror = function (er) {
      me.emit('error', er)

      // if didn't throw, then means error was handled.
      // go ahead and clear error, so we can write again.
      me._parser.error = null
    }

    this._decoder = null

    streamWraps.forEach(function (ev) {
      Object.defineProperty(me, 'on' + ev, {
        get: function () {
          return me._parser['on' + ev]
        },
        set: function (h) {
          if (!h) {
            me.removeAllListeners(ev)
            me._parser['on' + ev] = h
            return h
          }
          me.on(ev, h)
        },
        enumerable: true,
        configurable: false
      })
    })
  }

  SAXStream.prototype = Object.create(Stream.prototype, {
    constructor: {
      value: SAXStream
    }
  })

  SAXStream.prototype.write = function (data) {
    if (typeof Buffer === 'function' &&
      typeof Buffer.isBuffer === 'function' &&
      Buffer.isBuffer(data)) {
      if (!this._decoder) {
        var SD = require('string_decoder').StringDecoder
        this._decoder = new SD('utf8')
      }
      data = this._decoder.write(data)
    }

    this._parser.write(data.toString())
    this.emit('data', data)
    return true
  }

  SAXStream.prototype.end = function (chunk) {
    if (chunk && chunk.length) {
      this.write(chunk)
    }
    this._parser.end()
    return true
  }

  SAXStream.prototype.on = function (ev, handler) {
    var me = this
    if (!me._parser['on' + ev] && streamWraps.indexOf(ev) !== -1) {
      me._parser['on' + ev] = function () {
        var args = arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments)
        args.splice(0, 0, ev)
        me.emit.apply(me, args)
      }
    }

    return Stream.prototype.on.call(me, ev, handler)
  }

  // character classes and tokens
  var whitespace = '\r\n\t '

  // this really needs to be replaced with character classes.
  // XML allows all manner of ridiculous numbers and digits.

  // (Letter | "_" | ":")
  var quote = '\'"'
  var attribEnd = whitespace + '>'
  var CDATA = '[CDATA['
  var DOCTYPE = 'DOCTYPE'
  var XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
  var XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
  var rootNS = { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE }

  // turn all the string character sets into character class objects.
  whitespace = charClass(whitespace)

  // http://www.w3.org/TR/REC-xml/#NT-NameStartChar
  // This implementation works on strings, a single character at a time
  // as such, it cannot ever support astral-plane characters (10000-EFFFF)
  // without a significant breaking change to either this  parser, or the
  // JavaScript language.  Implementation of an emoji-capable xml parser
  // is left as an exercise for the reader.
  var nameStart = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/

  var nameBody = /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/

  var entityStart = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/
  var entityBody = /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/

  quote = charClass(quote)
  attribEnd = charClass(attribEnd)

  function charClass (str) {
    return str.split('').reduce(function (s, c) {
      s[c] = true
      return s
    }, {})
  }

  function isMatch (regex, c) {
    return regex.test(c)
  }

  function is (charclass, c) {
    return charclass[c]
  }

  function notMatch (regex, c) {
    return !isMatch(regex, c)
  }

  function not (charclass, c) {
    return !is(charclass, c)
  }

  var S = 0
  sax.STATE = {
    BEGIN: S++, // leading byte order mark or whitespace
    BEGIN_WHITESPACE: S++, // leading whitespace
    TEXT: S++, // general stuff
    TEXT_ENTITY: S++, // &amp and such.
    OPEN_WAKA: S++, // <
    SGML_DECL: S++, // <!BLARG
    SGML_DECL_QUOTED: S++, // <!BLARG foo "bar
    DOCTYPE: S++, // <!DOCTYPE
    DOCTYPE_QUOTED: S++, // <!DOCTYPE "//blah
    DOCTYPE_DTD: S++, // <!DOCTYPE "//blah" [ ...
    DOCTYPE_DTD_QUOTED: S++, // <!DOCTYPE "//blah" [ "foo
    COMMENT_STARTING: S++, // <!-
    COMMENT: S++, // <!--
    COMMENT_ENDING: S++, // <!-- blah -
    COMMENT_ENDED: S++, // <!-- blah --
    CDATA: S++, // <![CDATA[ something
    CDATA_ENDING: S++, // ]
    CDATA_ENDING_2: S++, // ]]
    PROC_INST: S++, // <?hi
    PROC_INST_BODY: S++, // <?hi there
    PROC_INST_ENDING: S++, // <?hi "there" ?
    OPEN_TAG: S++, // <strong
    OPEN_TAG_SLASH: S++, // <strong /
    ATTRIB: S++, // <a
    ATTRIB_NAME: S++, // <a foo
    ATTRIB_NAME_SAW_WHITE: S++, // <a foo _
    ATTRIB_VALUE: S++, // <a foo=
    ATTRIB_VALUE_QUOTED: S++, // <a foo="bar
    ATTRIB_VALUE_CLOSED: S++, // <a foo="bar"
    ATTRIB_VALUE_UNQUOTED: S++, // <a foo=bar
    ATTRIB_VALUE_ENTITY_Q: S++, // <foo bar="&quot;"
    ATTRIB_VALUE_ENTITY_U: S++, // <foo bar=&quot
    CLOSE_TAG: S++, // </a
    CLOSE_TAG_SAW_WHITE: S++, // </a   >
    SCRIPT: S++, // <script> ...
    SCRIPT_ENDING: S++ // <script> ... <
  }

  sax.XML_ENTITIES = {
    'amp': '&',
    'gt': '>',
    'lt': '<',
    'quot': '"',
    'apos': "'"
  }

  sax.ENTITIES = {
    'amp': '&',
    'gt': '>',
    'lt': '<',
    'quot': '"',
    'apos': "'",
    'AElig': 198,
    'Aacute': 193,
    'Acirc': 194,
    'Agrave': 192,
    'Aring': 197,
    'Atilde': 195,
    'Auml': 196,
    'Ccedil': 199,
    'ETH': 208,
    'Eacute': 201,
    'Ecirc': 202,
    'Egrave': 200,
    'Euml': 203,
    'Iacute': 205,
    'Icirc': 206,
    'Igrave': 204,
    'Iuml': 207,
    'Ntilde': 209,
    'Oacute': 211,
    'Ocirc': 212,
    'Ograve': 210,
    'Oslash': 216,
    'Otilde': 213,
    'Ouml': 214,
    'THORN': 222,
    'Uacute': 218,
    'Ucirc': 219,
    'Ugrave': 217,
    'Uuml': 220,
    'Yacute': 221,
    'aacute': 225,
    'acirc': 226,
    'aelig': 230,
    'agrave': 224,
    'aring': 229,
    'atilde': 227,
    'auml': 228,
    'ccedil': 231,
    'eacute': 233,
    'ecirc': 234,
    'egrave': 232,
    'eth': 240,
    'euml': 235,
    'iacute': 237,
    'icirc': 238,
    'igrave': 236,
    'iuml': 239,
    'ntilde': 241,
    'oacute': 243,
    'ocirc': 244,
    'ograve': 242,
    'oslash': 248,
    'otilde': 245,
    'ouml': 246,
    'szlig': 223,
    'thorn': 254,
    'uacute': 250,
    'ucirc': 251,
    'ugrave': 249,
    'uuml': 252,
    'yacute': 253,
    'yuml': 255,
    'copy': 169,
    'reg': 174,
    'nbsp': 160,
    'iexcl': 161,
    'cent': 162,
    'pound': 163,
    'curren': 164,
    'yen': 165,
    'brvbar': 166,
    'sect': 167,
    'uml': 168,
    'ordf': 170,
    'laquo': 171,
    'not': 172,
    'shy': 173,
    'macr': 175,
    'deg': 176,
    'plusmn': 177,
    'sup1': 185,
    'sup2': 178,
    'sup3': 179,
    'acute': 180,
    'micro': 181,
    'para': 182,
    'middot': 183,
    'cedil': 184,
    'ordm': 186,
    'raquo': 187,
    'frac14': 188,
    'frac12': 189,
    'frac34': 190,
    'iquest': 191,
    'times': 215,
    'divide': 247,
    'OElig': 338,
    'oelig': 339,
    'Scaron': 352,
    'scaron': 353,
    'Yuml': 376,
    'fnof': 402,
    'circ': 710,
    'tilde': 732,
    'Alpha': 913,
    'Beta': 914,
    'Gamma': 915,
    'Delta': 916,
    'Epsilon': 917,
    'Zeta': 918,
    'Eta': 919,
    'Theta': 920,
    'Iota': 921,
    'Kappa': 922,
    'Lambda': 923,
    'Mu': 924,
    'Nu': 925,
    'Xi': 926,
    'Omicron': 927,
    'Pi': 928,
    'Rho': 929,
    'Sigma': 931,
    'Tau': 932,
    'Upsilon': 933,
    'Phi': 934,
    'Chi': 935,
    'Psi': 936,
    'Omega': 937,
    'alpha': 945,
    'beta': 946,
    'gamma': 947,
    'delta': 948,
    'epsilon': 949,
    'zeta': 950,
    'eta': 951,
    'theta': 952,
    'iota': 953,
    'kappa': 954,
    'lambda': 955,
    'mu': 956,
    'nu': 957,
    'xi': 958,
    'omicron': 959,
    'pi': 960,
    'rho': 961,
    'sigmaf': 962,
    'sigma': 963,
    'tau': 964,
    'upsilon': 965,
    'phi': 966,
    'chi': 967,
    'psi': 968,
    'omega': 969,
    'thetasym': 977,
    'upsih': 978,
    'piv': 982,
    'ensp': 8194,
    'emsp': 8195,
    'thinsp': 8201,
    'zwnj': 8204,
    'zwj': 8205,
    'lrm': 8206,
    'rlm': 8207,
    'ndash': 8211,
    'mdash': 8212,
    'lsquo': 8216,
    'rsquo': 8217,
    'sbquo': 8218,
    'ldquo': 8220,
    'rdquo': 8221,
    'bdquo': 8222,
    'dagger': 8224,
    'Dagger': 8225,
    'bull': 8226,
    'hellip': 8230,
    'permil': 8240,
    'prime': 8242,
    'Prime': 8243,
    'lsaquo': 8249,
    'rsaquo': 8250,
    'oline': 8254,
    'frasl': 8260,
    'euro': 8364,
    'image': 8465,
    'weierp': 8472,
    'real': 8476,
    'trade': 8482,
    'alefsym': 8501,
    'larr': 8592,
    'uarr': 8593,
    'rarr': 8594,
    'darr': 8595,
    'harr': 8596,
    'crarr': 8629,
    'lArr': 8656,
    'uArr': 8657,
    'rArr': 8658,
    'dArr': 8659,
    'hArr': 8660,
    'forall': 8704,
    'part': 8706,
    'exist': 8707,
    'empty': 8709,
    'nabla': 8711,
    'isin': 8712,
    'notin': 8713,
    'ni': 8715,
    'prod': 8719,
    'sum': 8721,
    'minus': 8722,
    'lowast': 8727,
    'radic': 8730,
    'prop': 8733,
    'infin': 8734,
    'ang': 8736,
    'and': 8743,
    'or': 8744,
    'cap': 8745,
    'cup': 8746,
    'int': 8747,
    'there4': 8756,
    'sim': 8764,
    'cong': 8773,
    'asymp': 8776,
    'ne': 8800,
    'equiv': 8801,
    'le': 8804,
    'ge': 8805,
    'sub': 8834,
    'sup': 8835,
    'nsub': 8836,
    'sube': 8838,
    'supe': 8839,
    'oplus': 8853,
    'otimes': 8855,
    'perp': 8869,
    'sdot': 8901,
    'lceil': 8968,
    'rceil': 8969,
    'lfloor': 8970,
    'rfloor': 8971,
    'lang': 9001,
    'rang': 9002,
    'loz': 9674,
    'spades': 9824,
    'clubs': 9827,
    'hearts': 9829,
    'diams': 9830
  }

  Object.keys(sax.ENTITIES).forEach(function (key) {
    var e = sax.ENTITIES[key]
    var s = typeof e === 'number' ? String.fromCharCode(e) : e
    sax.ENTITIES[key] = s
  })

  for (var s in sax.STATE) {
    sax.STATE[sax.STATE[s]] = s
  }

  // shorthand
  S = sax.STATE

  function emit (parser, event, data) {
    parser[event] && parser[event](data)
  }

  function emitNode (parser, nodeType, data) {
    if (parser.textNode) closeText(parser)
    emit(parser, nodeType, data)
  }

  function closeText (parser) {
    parser.textNode = textopts(parser.opt, parser.textNode)
    if (parser.textNode) emit(parser, 'ontext', parser.textNode)
    parser.textNode = ''
  }

  function textopts (opt, text) {
    if (opt.trim) text = text.trim()
    if (opt.normalize) text = text.replace(/\s+/g, ' ')
    return text
  }

  function error (parser, er) {
    closeText(parser)
    if (parser.trackPosition) {
      er += '\nLine: ' + parser.line +
        '\nColumn: ' + parser.column +
        '\nChar: ' + parser.c
    }
    er = new Error(er)
    parser.error = er
    emit(parser, 'onerror', er)
    return parser
  }

  function end (parser) {
    if (parser.sawRoot && !parser.closedRoot) strictFail(parser, 'Unclosed root tag')
    if ((parser.state !== S.BEGIN) &&
      (parser.state !== S.BEGIN_WHITESPACE) &&
      (parser.state !== S.TEXT)) {
      error(parser, 'Unexpected end')
    }
    closeText(parser)
    parser.c = ''
    parser.closed = true
    emit(parser, 'onend')
    SAXParser.call(parser, parser.strict, parser.opt)
    return parser
  }

  function strictFail (parser, message) {
    if (typeof parser !== 'object' || !(parser instanceof SAXParser)) {
      throw new Error('bad call to strictFail')
    }
    if (parser.strict) {
      error(parser, message)
    }
  }

  function newTag (parser) {
    if (!parser.strict) parser.tagName = parser.tagName[parser.looseCase]()
    var parent = parser.tags[parser.tags.length - 1] || parser
    var tag = parser.tag = { name: parser.tagName, attributes: {} }

    // will be overridden if tag contails an xmlns="foo" or xmlns:foo="bar"
    if (parser.opt.xmlns) {
      tag.ns = parent.ns
    }
    parser.attribList.length = 0
    emitNode(parser, 'onopentagstart', tag)
  }

  function qname (name, attribute) {
    var i = name.indexOf(':')
    var qualName = i < 0 ? [ '', name ] : name.split(':')
    var prefix = qualName[0]
    var local = qualName[1]

    // <x "xmlns"="http://foo">
    if (attribute && name === 'xmlns') {
      prefix = 'xmlns'
      local = ''
    }

    return { prefix: prefix, local: local }
  }

  function attrib (parser) {
    if (!parser.strict) {
      parser.attribName = parser.attribName[parser.looseCase]()
    }

    if (parser.attribList.indexOf(parser.attribName) !== -1 ||
      parser.tag.attributes.hasOwnProperty(parser.attribName)) {
      parser.attribName = parser.attribValue = ''
      return
    }

    if (parser.opt.xmlns) {
      var qn = qname(parser.attribName, true)
      var prefix = qn.prefix
      var local = qn.local

      if (prefix === 'xmlns') {
        // namespace binding attribute. push the binding into scope
        if (local === 'xml' && parser.attribValue !== XML_NAMESPACE) {
          strictFail(parser,
            'xml: prefix must be bound to ' + XML_NAMESPACE + '\n' +
            'Actual: ' + parser.attribValue)
        } else if (local === 'xmlns' && parser.attribValue !== XMLNS_NAMESPACE) {
          strictFail(parser,
            'xmlns: prefix must be bound to ' + XMLNS_NAMESPACE + '\n' +
            'Actual: ' + parser.attribValue)
        } else {
          var tag = parser.tag
          var parent = parser.tags[parser.tags.length - 1] || parser
          if (tag.ns === parent.ns) {
            tag.ns = Object.create(parent.ns)
          }
          tag.ns[local] = parser.attribValue
        }
      }

      // defer onattribute events until all attributes have been seen
      // so any new bindings can take effect. preserve attribute order
      // so deferred events can be emitted in document order
      parser.attribList.push([parser.attribName, parser.attribValue])
    } else {
      // in non-xmlns mode, we can emit the event right away
      parser.tag.attributes[parser.attribName] = parser.attribValue
      emitNode(parser, 'onattribute', {
        name: parser.attribName,
        value: parser.attribValue
      })
    }

    parser.attribName = parser.attribValue = ''
  }

  function openTag (parser, selfClosing) {
    if (parser.opt.xmlns) {
      // emit namespace binding events
      var tag = parser.tag

      // add namespace info to tag
      var qn = qname(parser.tagName)
      tag.prefix = qn.prefix
      tag.local = qn.local
      tag.uri = tag.ns[qn.prefix] || ''

      if (tag.prefix && !tag.uri) {
        strictFail(parser, 'Unbound namespace prefix: ' +
          JSON.stringify(parser.tagName))
        tag.uri = qn.prefix
      }

      var parent = parser.tags[parser.tags.length - 1] || parser
      if (tag.ns && parent.ns !== tag.ns) {
        Object.keys(tag.ns).forEach(function (p) {
          emitNode(parser, 'onopennamespace', {
            prefix: p,
            uri: tag.ns[p]
          })
        })
      }

      // handle deferred onattribute events
      // Note: do not apply default ns to attributes:
      //   http://www.w3.org/TR/REC-xml-names/#defaulting
      for (var i = 0, l = parser.attribList.length; i < l; i++) {
        var nv = parser.attribList[i]
        var name = nv[0]
        var value = nv[1]
        var qualName = qname(name, true)
        var prefix = qualName.prefix
        var local = qualName.local
        var uri = prefix === '' ? '' : (tag.ns[prefix] || '')
        var a = {
          name: name,
          value: value,
          prefix: prefix,
          local: local,
          uri: uri
        }

        // if there's any attributes with an undefined namespace,
        // then fail on them now.
        if (prefix && prefix !== 'xmlns' && !uri) {
          strictFail(parser, 'Unbound namespace prefix: ' +
            JSON.stringify(prefix))
          a.uri = prefix
        }
        parser.tag.attributes[name] = a
        emitNode(parser, 'onattribute', a)
      }
      parser.attribList.length = 0
    }

    parser.tag.isSelfClosing = !!selfClosing

    // process the tag
    parser.sawRoot = true
    parser.tags.push(parser.tag)
    emitNode(parser, 'onopentag', parser.tag)
    if (!selfClosing) {
      // special case for <script> in non-strict mode.
      if (!parser.noscript && parser.tagName.toLowerCase() === 'script') {
        parser.state = S.SCRIPT
      } else {
        parser.state = S.TEXT
      }
      parser.tag = null
      parser.tagName = ''
    }
    parser.attribName = parser.attribValue = ''
    parser.attribList.length = 0
  }

  function closeTag (parser) {
    if (!parser.tagName) {
      strictFail(parser, 'Weird empty close tag.')
      parser.textNode += '</>'
      parser.state = S.TEXT
      return
    }

    if (parser.script) {
      if (parser.tagName !== 'script') {
        parser.script += '</' + parser.tagName + '>'
        parser.tagName = ''
        parser.state = S.SCRIPT
        return
      }
      emitNode(parser, 'onscript', parser.script)
      parser.script = ''
    }

    // first make sure that the closing tag actually exists.
    // <a><b></c></b></a> will close everything, otherwise.
    var t = parser.tags.length
    var tagName = parser.tagName
    if (!parser.strict) {
      tagName = tagName[parser.looseCase]()
    }
    var closeTo = tagName
    while (t--) {
      var close = parser.tags[t]
      if (close.name !== closeTo) {
        // fail the first time in strict mode
        strictFail(parser, 'Unexpected close tag')
      } else {
        break
      }
    }

    // didn't find it.  we already failed for strict, so just abort.
    if (t < 0) {
      strictFail(parser, 'Unmatched closing tag: ' + parser.tagName)
      parser.textNode += '</' + parser.tagName + '>'
      parser.state = S.TEXT
      return
    }
    parser.tagName = tagName
    var s = parser.tags.length
    while (s-- > t) {
      var tag = parser.tag = parser.tags.pop()
      parser.tagName = parser.tag.name
      emitNode(parser, 'onclosetag', parser.tagName)

      var x = {}
      for (var i in tag.ns) {
        x[i] = tag.ns[i]
      }

      var parent = parser.tags[parser.tags.length - 1] || parser
      if (parser.opt.xmlns && tag.ns !== parent.ns) {
        // remove namespace bindings introduced by tag
        Object.keys(tag.ns).forEach(function (p) {
          var n = tag.ns[p]
          emitNode(parser, 'onclosenamespace', { prefix: p, uri: n })
        })
      }
    }
    if (t === 0) parser.closedRoot = true
    parser.tagName = parser.attribValue = parser.attribName = ''
    parser.attribList.length = 0
    parser.state = S.TEXT
  }

  function parseEntity (parser) {
    var entity = parser.entity
    var entityLC = entity.toLowerCase()
    var num
    var numStr = ''

    if (parser.ENTITIES[entity]) {
      return parser.ENTITIES[entity]
    }
    if (parser.ENTITIES[entityLC]) {
      return parser.ENTITIES[entityLC]
    }
    entity = entityLC
    if (entity.charAt(0) === '#') {
      if (entity.charAt(1) === 'x') {
        entity = entity.slice(2)
        num = parseInt(entity, 16)
        numStr = num.toString(16)
      } else {
        entity = entity.slice(1)
        num = parseInt(entity, 10)
        numStr = num.toString(10)
      }
    }
    entity = entity.replace(/^0+/, '')
    if (numStr.toLowerCase() !== entity) {
      strictFail(parser, 'Invalid character entity')
      return '&' + parser.entity + ';'
    }

    return String.fromCodePoint(num)
  }

  function beginWhiteSpace (parser, c) {
    if (c === '<') {
      parser.state = S.OPEN_WAKA
      parser.startTagPosition = parser.position
    } else if (not(whitespace, c)) {
      // have to process this as a text node.
      // weird, but happens.
      strictFail(parser, 'Non-whitespace before first tag.')
      parser.textNode = c
      parser.state = S.TEXT
    }
  }

  function charAt (chunk, i) {
    var result = ''
    if (i < chunk.length) {
      result = chunk.charAt(i)
    }
    return result
  }

  function write (chunk) {
    var parser = this
    if (this.error) {
      throw this.error
    }
    if (parser.closed) {
      return error(parser,
        'Cannot write after close. Assign an onready handler.')
    }
    if (chunk === null) {
      return end(parser)
    }
    if (typeof chunk === 'object') {
      chunk = chunk.toString()
    }
    var i = 0
    var c = ''
    while (true) {
      c = charAt(chunk, i++)
      parser.c = c

      if (!c) {
        break
      }

      if (parser.trackPosition) {
        parser.position++
        if (c === '\n') {
          parser.line++
          parser.column = 0
        } else {
          parser.column++
        }
      }

      switch (parser.state) {
        case S.BEGIN:
          parser.state = S.BEGIN_WHITESPACE
          if (c === '\uFEFF') {
            continue
          }
          beginWhiteSpace(parser, c)
          continue

        case S.BEGIN_WHITESPACE:
          beginWhiteSpace(parser, c)
          continue

        case S.TEXT:
          if (parser.sawRoot && !parser.closedRoot) {
            var starti = i - 1
            while (c && c !== '<' && c !== '&') {
              c = charAt(chunk, i++)
              if (c && parser.trackPosition) {
                parser.position++
                if (c === '\n') {
                  parser.line++
                  parser.column = 0
                } else {
                  parser.column++
                }
              }
            }
            parser.textNode += chunk.substring(starti, i - 1)
          }
          if (c === '<' && !(parser.sawRoot && parser.closedRoot && !parser.strict)) {
            parser.state = S.OPEN_WAKA
            parser.startTagPosition = parser.position
          } else {
            if (not(whitespace, c) && (!parser.sawRoot || parser.closedRoot)) {
              strictFail(parser, 'Text data outside of root node.')
            }
            if (c === '&') {
              parser.state = S.TEXT_ENTITY
            } else {
              parser.textNode += c
            }
          }
          continue

        case S.SCRIPT:
          // only non-strict
          if (c === '<') {
            parser.state = S.SCRIPT_ENDING
          } else {
            parser.script += c
          }
          continue

        case S.SCRIPT_ENDING:
          if (c === '/') {
            parser.state = S.CLOSE_TAG
          } else {
            parser.script += '<' + c
            parser.state = S.SCRIPT
          }
          continue

        case S.OPEN_WAKA:
          // either a /, ?, !, or text is coming next.
          if (c === '!') {
            parser.state = S.SGML_DECL
            parser.sgmlDecl = ''
          } else if (is(whitespace, c)) {
            // wait for it...
          } else if (isMatch(nameStart, c)) {
            parser.state = S.OPEN_TAG
            parser.tagName = c
          } else if (c === '/') {
            parser.state = S.CLOSE_TAG
            parser.tagName = ''
          } else if (c === '?') {
            parser.state = S.PROC_INST
            parser.procInstName = parser.procInstBody = ''
          } else {
            strictFail(parser, 'Unencoded <')
            // if there was some whitespace, then add that in.
            if (parser.startTagPosition + 1 < parser.position) {
              var pad = parser.position - parser.startTagPosition
              c = new Array(pad).join(' ') + c
            }
            parser.textNode += '<' + c
            parser.state = S.TEXT
          }
          continue

        case S.SGML_DECL:
          if ((parser.sgmlDecl + c).toUpperCase() === CDATA) {
            emitNode(parser, 'onopencdata')
            parser.state = S.CDATA
            parser.sgmlDecl = ''
            parser.cdata = ''
          } else if (parser.sgmlDecl + c === '--') {
            parser.state = S.COMMENT
            parser.comment = ''
            parser.sgmlDecl = ''
          } else if ((parser.sgmlDecl + c).toUpperCase() === DOCTYPE) {
            parser.state = S.DOCTYPE
            if (parser.doctype || parser.sawRoot) {
              strictFail(parser,
                'Inappropriately located doctype declaration')
            }
            parser.doctype = ''
            parser.sgmlDecl = ''
          } else if (c === '>') {
            emitNode(parser, 'onsgmldeclaration', parser.sgmlDecl)
            parser.sgmlDecl = ''
            parser.state = S.TEXT
          } else if (is(quote, c)) {
            parser.state = S.SGML_DECL_QUOTED
            parser.sgmlDecl += c
          } else {
            parser.sgmlDecl += c
          }
          continue

        case S.SGML_DECL_QUOTED:
          if (c === parser.q) {
            parser.state = S.SGML_DECL
            parser.q = ''
          }
          parser.sgmlDecl += c
          continue

        case S.DOCTYPE:
          if (c === '>') {
            parser.state = S.TEXT
            emitNode(parser, 'ondoctype', parser.doctype)
            parser.doctype = true // just remember that we saw it.
          } else {
            parser.doctype += c
            if (c === '[') {
              parser.state = S.DOCTYPE_DTD
            } else if (is(quote, c)) {
              parser.state = S.DOCTYPE_QUOTED
              parser.q = c
            }
          }
          continue

        case S.DOCTYPE_QUOTED:
          parser.doctype += c
          if (c === parser.q) {
            parser.q = ''
            parser.state = S.DOCTYPE
          }
          continue

        case S.DOCTYPE_DTD:
          parser.doctype += c
          if (c === ']') {
            parser.state = S.DOCTYPE
          } else if (is(quote, c)) {
            parser.state = S.DOCTYPE_DTD_QUOTED
            parser.q = c
          }
          continue

        case S.DOCTYPE_DTD_QUOTED:
          parser.doctype += c
          if (c === parser.q) {
            parser.state = S.DOCTYPE_DTD
            parser.q = ''
          }
          continue

        case S.COMMENT:
          if (c === '-') {
            parser.state = S.COMMENT_ENDING
          } else {
            parser.comment += c
          }
          continue

        case S.COMMENT_ENDING:
          if (c === '-') {
            parser.state = S.COMMENT_ENDED
            parser.comment = textopts(parser.opt, parser.comment)
            if (parser.comment) {
              emitNode(parser, 'oncomment', parser.comment)
            }
            parser.comment = ''
          } else {
            parser.comment += '-' + c
            parser.state = S.COMMENT
          }
          continue

        case S.COMMENT_ENDED:
          if (c !== '>') {
            strictFail(parser, 'Malformed comment')
            // allow <!-- blah -- bloo --> in non-strict mode,
            // which is a comment of " blah -- bloo "
            parser.comment += '--' + c
            parser.state = S.COMMENT
          } else {
            parser.state = S.TEXT
          }
          continue

        case S.CDATA:
          if (c === ']') {
            parser.state = S.CDATA_ENDING
          } else {
            parser.cdata += c
          }
          continue

        case S.CDATA_ENDING:
          if (c === ']') {
            parser.state = S.CDATA_ENDING_2
          } else {
            parser.cdata += ']' + c
            parser.state = S.CDATA
          }
          continue

        case S.CDATA_ENDING_2:
          if (c === '>') {
            if (parser.cdata) {
              emitNode(parser, 'oncdata', parser.cdata)
            }
            emitNode(parser, 'onclosecdata')
            parser.cdata = ''
            parser.state = S.TEXT
          } else if (c === ']') {
            parser.cdata += ']'
          } else {
            parser.cdata += ']]' + c
            parser.state = S.CDATA
          }
          continue

        case S.PROC_INST:
          if (c === '?') {
            parser.state = S.PROC_INST_ENDING
          } else if (is(whitespace, c)) {
            parser.state = S.PROC_INST_BODY
          } else {
            parser.procInstName += c
          }
          continue

        case S.PROC_INST_BODY:
          if (!parser.procInstBody && is(whitespace, c)) {
            continue
          } else if (c === '?') {
            parser.state = S.PROC_INST_ENDING
          } else {
            parser.procInstBody += c
          }
          continue

        case S.PROC_INST_ENDING:
          if (c === '>') {
            emitNode(parser, 'onprocessinginstruction', {
              name: parser.procInstName,
              body: parser.procInstBody
            })
            parser.procInstName = parser.procInstBody = ''
            parser.state = S.TEXT
          } else {
            parser.procInstBody += '?' + c
            parser.state = S.PROC_INST_BODY
          }
          continue

        case S.OPEN_TAG:
          if (isMatch(nameBody, c)) {
            parser.tagName += c
          } else {
            newTag(parser)
            if (c === '>') {
              openTag(parser)
            } else if (c === '/') {
              parser.state = S.OPEN_TAG_SLASH
            } else {
              if (not(whitespace, c)) {
                strictFail(parser, 'Invalid character in tag name')
              }
              parser.state = S.ATTRIB
            }
          }
          continue

        case S.OPEN_TAG_SLASH:
          if (c === '>') {
            openTag(parser, true)
            closeTag(parser)
          } else {
            strictFail(parser, 'Forward-slash in opening tag not followed by >')
            parser.state = S.ATTRIB
          }
          continue

        case S.ATTRIB:
          // haven't read the attribute name yet.
          if (is(whitespace, c)) {
            continue
          } else if (c === '>') {
            openTag(parser)
          } else if (c === '/') {
            parser.state = S.OPEN_TAG_SLASH
          } else if (isMatch(nameStart, c)) {
            parser.attribName = c
            parser.attribValue = ''
            parser.state = S.ATTRIB_NAME
          } else {
            strictFail(parser, 'Invalid attribute name')
          }
          continue

        case S.ATTRIB_NAME:
          if (c === '=') {
            parser.state = S.ATTRIB_VALUE
          } else if (c === '>') {
            strictFail(parser, 'Attribute without value')
            parser.attribValue = parser.attribName
            attrib(parser)
            openTag(parser)
          } else if (is(whitespace, c)) {
            parser.state = S.ATTRIB_NAME_SAW_WHITE
          } else if (isMatch(nameBody, c)) {
            parser.attribName += c
          } else {
            strictFail(parser, 'Invalid attribute name')
          }
          continue

        case S.ATTRIB_NAME_SAW_WHITE:
          if (c === '=') {
            parser.state = S.ATTRIB_VALUE
          } else if (is(whitespace, c)) {
            continue
          } else {
            strictFail(parser, 'Attribute without value')
            parser.tag.attributes[parser.attribName] = ''
            parser.attribValue = ''
            emitNode(parser, 'onattribute', {
              name: parser.attribName,
              value: ''
            })
            parser.attribName = ''
            if (c === '>') {
              openTag(parser)
            } else if (isMatch(nameStart, c)) {
              parser.attribName = c
              parser.state = S.ATTRIB_NAME
            } else {
              strictFail(parser, 'Invalid attribute name')
              parser.state = S.ATTRIB
            }
          }
          continue

        case S.ATTRIB_VALUE:
          if (is(whitespace, c)) {
            continue
          } else if (is(quote, c)) {
            parser.q = c
            parser.state = S.ATTRIB_VALUE_QUOTED
          } else {
            strictFail(parser, 'Unquoted attribute value')
            parser.state = S.ATTRIB_VALUE_UNQUOTED
            parser.attribValue = c
          }
          continue

        case S.ATTRIB_VALUE_QUOTED:
          if (c !== parser.q) {
            if (c === '&') {
              parser.state = S.ATTRIB_VALUE_ENTITY_Q
            } else {
              parser.attribValue += c
            }
            continue
          }
          attrib(parser)
          parser.q = ''
          parser.state = S.ATTRIB_VALUE_CLOSED
          continue

        case S.ATTRIB_VALUE_CLOSED:
          if (is(whitespace, c)) {
            parser.state = S.ATTRIB
          } else if (c === '>') {
            openTag(parser)
          } else if (c === '/') {
            parser.state = S.OPEN_TAG_SLASH
          } else if (isMatch(nameStart, c)) {
            strictFail(parser, 'No whitespace between attributes')
            parser.attribName = c
            parser.attribValue = ''
            parser.state = S.ATTRIB_NAME
          } else {
            strictFail(parser, 'Invalid attribute name')
          }
          continue

        case S.ATTRIB_VALUE_UNQUOTED:
          if (not(attribEnd, c)) {
            if (c === '&') {
              parser.state = S.ATTRIB_VALUE_ENTITY_U
            } else {
              parser.attribValue += c
            }
            continue
          }
          attrib(parser)
          if (c === '>') {
            openTag(parser)
          } else {
            parser.state = S.ATTRIB
          }
          continue

        case S.CLOSE_TAG:
          if (!parser.tagName) {
            if (is(whitespace, c)) {
              continue
            } else if (notMatch(nameStart, c)) {
              if (parser.script) {
                parser.script += '</' + c
                parser.state = S.SCRIPT
              } else {
                strictFail(parser, 'Invalid tagname in closing tag.')
              }
            } else {
              parser.tagName = c
            }
          } else if (c === '>') {
            closeTag(parser)
          } else if (isMatch(nameBody, c)) {
            parser.tagName += c
          } else if (parser.script) {
            parser.script += '</' + parser.tagName
            parser.tagName = ''
            parser.state = S.SCRIPT
          } else {
            if (not(whitespace, c)) {
              strictFail(parser, 'Invalid tagname in closing tag')
            }
            parser.state = S.CLOSE_TAG_SAW_WHITE
          }
          continue

        case S.CLOSE_TAG_SAW_WHITE:
          if (is(whitespace, c)) {
            continue
          }
          if (c === '>') {
            closeTag(parser)
          } else {
            strictFail(parser, 'Invalid characters in closing tag')
          }
          continue

        case S.TEXT_ENTITY:
        case S.ATTRIB_VALUE_ENTITY_Q:
        case S.ATTRIB_VALUE_ENTITY_U:
          var returnState
          var buffer
          switch (parser.state) {
            case S.TEXT_ENTITY:
              returnState = S.TEXT
              buffer = 'textNode'
              break

            case S.ATTRIB_VALUE_ENTITY_Q:
              returnState = S.ATTRIB_VALUE_QUOTED
              buffer = 'attribValue'
              break

            case S.ATTRIB_VALUE_ENTITY_U:
              returnState = S.ATTRIB_VALUE_UNQUOTED
              buffer = 'attribValue'
              break
          }

          if (c === ';') {
            parser[buffer] += parseEntity(parser)
            parser.entity = ''
            parser.state = returnState
          } else if (isMatch(parser.entity.length ? entityBody : entityStart, c)) {
            parser.entity += c
          } else {
            strictFail(parser, 'Invalid character in entity name')
            parser[buffer] += '&' + parser.entity + c
            parser.entity = ''
            parser.state = returnState
          }

          continue

        default:
          throw new Error(parser, 'Unknown state: ' + parser.state)
      }
    } // while

    if (parser.position >= parser.bufferCheckPosition) {
      checkBufferLength(parser)
    }
    return parser
  }

  /*! http://mths.be/fromcodepoint v0.1.0 by @mathias */
  /* istanbul ignore next */
  if (!String.fromCodePoint) {
    (function () {
      var stringFromCharCode = String.fromCharCode
      var floor = Math.floor
      var fromCodePoint = function () {
        var MAX_SIZE = 0x4000
        var codeUnits = []
        var highSurrogate
        var lowSurrogate
        var index = -1
        var length = arguments.length
        if (!length) {
          return ''
        }
        var result = ''
        while (++index < length) {
          var codePoint = Number(arguments[index])
          if (
            !isFinite(codePoint) || // `NaN`, `+Infinity`, or `-Infinity`
            codePoint < 0 || // not a valid Unicode code point
            codePoint > 0x10FFFF || // not a valid Unicode code point
            floor(codePoint) !== codePoint // not an integer
          ) {
            throw RangeError('Invalid code point: ' + codePoint)
          }
          if (codePoint <= 0xFFFF) { // BMP code point
            codeUnits.push(codePoint)
          } else { // Astral code point; split in surrogate halves
            // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
            codePoint -= 0x10000
            highSurrogate = (codePoint >> 10) + 0xD800
            lowSurrogate = (codePoint % 0x400) + 0xDC00
            codeUnits.push(highSurrogate, lowSurrogate)
          }
          if (index + 1 === length || codeUnits.length > MAX_SIZE) {
            result += stringFromCharCode.apply(null, codeUnits)
            codeUnits.length = 0
          }
        }
        return result
      }
      /* istanbul ignore next */
      if (Object.defineProperty) {
        Object.defineProperty(String, 'fromCodePoint', {
          value: fromCodePoint,
          configurable: true,
          writable: true
        })
      } else {
        String.fromCodePoint = fromCodePoint
      }
    }())
  }
})(typeof exports === 'undefined' ? this.sax = {} : exports)

}).call(this,require("buffer").Buffer)
},{"buffer":8,"stream":31,"string_decoder":6}],31:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":10,"inherits":13,"readable-stream/duplex.js":18,"readable-stream/passthrough.js":26,"readable-stream/readable.js":27,"readable-stream/transform.js":28,"readable-stream/writable.js":29}],32:[function(require,module,exports){
'use strict';

var Buffer = require('buffer').Buffer;
var bufferShim = require('buffer-shims');

var isEncoding = Buffer.isEncoding || function (encoding) {
  encoding = '' + encoding;
  switch (encoding && encoding.toLowerCase()) {
    case 'hex':case 'utf8':case 'utf-8':case 'ascii':case 'binary':case 'base64':case 'ucs2':case 'ucs-2':case 'utf16le':case 'utf-16le':case 'raw':
      return true;
    default:
      return false;
  }
};

function _normalizeEncoding(enc) {
  if (!enc) return 'utf8';
  var retried;
  while (true) {
    switch (enc) {
      case 'utf8':
      case 'utf-8':
        return 'utf8';
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return 'utf16le';
      case 'latin1':
      case 'binary':
        return 'latin1';
      case 'base64':
      case 'ascii':
      case 'hex':
        return enc;
      default:
        if (retried) return; // undefined
        enc = ('' + enc).toLowerCase();
        retried = true;
    }
  }
};

// Do not cache `Buffer.isEncoding` when checking encoding names as some
// modules monkey-patch it to support additional encodings
function normalizeEncoding(enc) {
  var nenc = _normalizeEncoding(enc);
  if (typeof nenc !== 'string' && (Buffer.isEncoding === isEncoding || !isEncoding(enc))) throw new Error('Unknown encoding: ' + enc);
  return nenc || enc;
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters.
exports.StringDecoder = StringDecoder;
function StringDecoder(encoding) {
  this.encoding = normalizeEncoding(encoding);
  var nb;
  switch (this.encoding) {
    case 'utf16le':
      this.text = utf16Text;
      this.end = utf16End;
      nb = 4;
      break;
    case 'utf8':
      this.fillLast = utf8FillLast;
      nb = 4;
      break;
    case 'base64':
      this.text = base64Text;
      this.end = base64End;
      nb = 3;
      break;
    default:
      this.write = simpleWrite;
      this.end = simpleEnd;
      return;
  }
  this.lastNeed = 0;
  this.lastTotal = 0;
  this.lastChar = bufferShim.allocUnsafe(nb);
}

StringDecoder.prototype.write = function (buf) {
  if (buf.length === 0) return '';
  var r;
  var i;
  if (this.lastNeed) {
    r = this.fillLast(buf);
    if (r === undefined) return '';
    i = this.lastNeed;
    this.lastNeed = 0;
  } else {
    i = 0;
  }
  if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
  return r || '';
};

StringDecoder.prototype.end = utf8End;

// Returns only complete characters in a Buffer
StringDecoder.prototype.text = utf8Text;

// Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
StringDecoder.prototype.fillLast = function (buf) {
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
  this.lastNeed -= buf.length;
};

// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
// continuation byte.
function utf8CheckByte(byte) {
  if (byte <= 0x7F) return 0;else if (byte >> 5 === 0x06) return 2;else if (byte >> 4 === 0x0E) return 3;else if (byte >> 3 === 0x1E) return 4;
  return -1;
}

// Checks at most 3 bytes at the end of a Buffer in order to detect an
// incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
// needed to complete the UTF-8 character (if applicable) are returned.
function utf8CheckIncomplete(self, buf, i) {
  var j = buf.length - 1;
  if (j < i) return 0;
  var nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 1;
    return nb;
  }
  if (--j < i) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) self.lastNeed = nb - 2;
    return nb;
  }
  if (--j < i) return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) {
      if (nb === 2) nb = 0;else self.lastNeed = nb - 3;
    }
    return nb;
  }
  return 0;
}

// Validates as many continuation bytes for a multi-byte UTF-8 character as
// needed or are available. If we see a non-continuation byte where we expect
// one, we "replace" the validated continuation bytes we've seen so far with
// UTF-8 replacement characters ('\ufffd'), to match v8's UTF-8 decoding
// behavior. The continuation byte check is included three times in the case
// where all of the continuation bytes for a character exist in the same buffer.
// It is also done this way as a slight performance increase instead of using a
// loop.
function utf8CheckExtraBytes(self, buf, p) {
  if ((buf[0] & 0xC0) !== 0x80) {
    self.lastNeed = 0;
    return '\ufffd'.repeat(p);
  }
  if (self.lastNeed > 1 && buf.length > 1) {
    if ((buf[1] & 0xC0) !== 0x80) {
      self.lastNeed = 1;
      return '\ufffd'.repeat(p + 1);
    }
    if (self.lastNeed > 2 && buf.length > 2) {
      if ((buf[2] & 0xC0) !== 0x80) {
        self.lastNeed = 2;
        return '\ufffd'.repeat(p + 2);
      }
    }
  }
}

// Attempts to complete a multi-byte UTF-8 character using bytes from a Buffer.
function utf8FillLast(buf) {
  var p = this.lastTotal - this.lastNeed;
  var r = utf8CheckExtraBytes(this, buf, p);
  if (r !== undefined) return r;
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, p, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, p, 0, buf.length);
  this.lastNeed -= buf.length;
}

// Returns all complete UTF-8 characters in a Buffer. If the Buffer ended on a
// partial character, the character's bytes are buffered until the required
// number of bytes are available.
function utf8Text(buf, i) {
  var total = utf8CheckIncomplete(this, buf, i);
  if (!this.lastNeed) return buf.toString('utf8', i);
  this.lastTotal = total;
  var end = buf.length - (total - this.lastNeed);
  buf.copy(this.lastChar, 0, end);
  return buf.toString('utf8', i, end);
}

// For UTF-8, a replacement character for each buffered byte of a (partial)
// character needs to be added to the output.
function utf8End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) return r + '\ufffd'.repeat(this.lastTotal - this.lastNeed);
  return r;
}

// UTF-16LE typically needs two bytes per character, but even if we have an even
// number of bytes available, we need to check if we end on a leading/high
// surrogate. In that case, we need to wait for the next two bytes in order to
// decode the last character properly.
function utf16Text(buf, i) {
  if ((buf.length - i) % 2 === 0) {
    var r = buf.toString('utf16le', i);
    if (r) {
      var c = r.charCodeAt(r.length - 1);
      if (c >= 0xD800 && c <= 0xDBFF) {
        this.lastNeed = 2;
        this.lastTotal = 4;
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
        return r.slice(0, -1);
      }
    }
    return r;
  }
  this.lastNeed = 1;
  this.lastTotal = 2;
  this.lastChar[0] = buf[buf.length - 1];
  return buf.toString('utf16le', i, buf.length - 1);
}

// For UTF-16LE we do not explicitly append special replacement characters if we
// end on a partial character, we simply let v8 handle that.
function utf16End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) {
    var end = this.lastTotal - this.lastNeed;
    return r + this.lastChar.toString('utf16le', 0, end);
  }
  return r;
}

function base64Text(buf, i) {
  var n = (buf.length - i) % 3;
  if (n === 0) return buf.toString('base64', i);
  this.lastNeed = 3 - n;
  this.lastTotal = 3;
  if (n === 1) {
    this.lastChar[0] = buf[buf.length - 1];
  } else {
    this.lastChar[0] = buf[buf.length - 2];
    this.lastChar[1] = buf[buf.length - 1];
  }
  return buf.toString('base64', i, buf.length - n);
}

function base64End(buf) {
  var r = buf && buf.length ? this.write(buf) : '';
  if (this.lastNeed) return r + this.lastChar.toString('base64', 0, 3 - this.lastNeed);
  return r;
}

// Pass bytes on through for single-byte encodings (e.g. ascii, latin1, hex)
function simpleWrite(buf) {
  return buf.toString(this.encoding);
}

function simpleEnd(buf) {
  return buf && buf.length ? this.write(buf) : '';
}
},{"buffer":8,"buffer-shims":7}],33:[function(require,module,exports){
(function (global){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],34:[function(require,module,exports){
var bundleFn = arguments[3];
var sources = arguments[4];
var cache = arguments[5];

var stringify = JSON.stringify;

module.exports = function (fn, options) {
    var wkey;
    var cacheKeys = Object.keys(cache);

    for (var i = 0, l = cacheKeys.length; i < l; i++) {
        var key = cacheKeys[i];
        var exp = cache[key].exports;
        // Using babel as a transpiler to use esmodule, the export will always
        // be an object with the default export as a property of it. To ensure
        // the existing api and babel esmodule exports are both supported we
        // check for both
        if (exp === fn || exp && exp.default === fn) {
            wkey = key;
            break;
        }
    }

    if (!wkey) {
        wkey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);
        var wcache = {};
        for (var i = 0, l = cacheKeys.length; i < l; i++) {
            var key = cacheKeys[i];
            wcache[key] = key;
        }
        sources[wkey] = [
            Function(['require','module','exports'], '(' + fn + ')(self)'),
            wcache
        ];
    }
    var skey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);

    var scache = {}; scache[wkey] = wkey;
    sources[skey] = [
        Function(['require'], (
            // try to call default if defined to also support babel esmodule
            // exports
            'var f = require(' + stringify(wkey) + ');' +
            '(f.default ? f.default : f)(self);'
        )),
        scache
    ];

    var workerSources = {};
    resolveSources(skey);

    function resolveSources(key) {
        workerSources[key] = true;

        for (var depPath in sources[key][1]) {
            var depKey = sources[key][1][depPath];
            if (!workerSources[depKey]) {
                resolveSources(depKey);
            }
        }
    }

    var src = '(' + bundleFn + ')({'
        + Object.keys(workerSources).map(function (key) {
            return stringify(key) + ':['
                + sources[key][0]
                + ',' + stringify(sources[key][1]) + ']'
            ;
        }).join(',')
        + '},{},[' + stringify(skey) + '])'
    ;

    var URL = window.URL || window.webkitURL || window.mozURL || window.msURL;

    var blob = new Blob([src], { type: 'text/javascript' });
    if (options && options.bare) { return blob; }
    var workerUrl = URL.createObjectURL(blob);
    var worker = new Worker(workerUrl);
    worker.objectURL = workerUrl;
    return worker;
};

},{}],35:[function(require,module,exports){
module.exports={
  "name": "openjscad",
  "version": "0.5.2",
  "description": "",
  "repository": "https://github.com/Spiritdude/OpenJSCAD.org",
  "main": "dist/module.js",
  "bin": {
    "openjscad": "dist/cli.js"
  },
  "scripts": {
    "test": "ava './src/**/*.test.js' --require babel-register --verbose --timeout 10000",
    "build-web": "browserify src/ui/index.js -o dist/index.js -t [babelify browserify minifyify]",
    "build-min": "browserify src/ui/min.js -o dist/min.js -t [babelify browserify minifyify]",
    "build-opt": "browserify src/ui/opt.js -o dist/opt.js -t [babelify browserify minifyify]",
    "build-module": "rollup -c rollup.config.module.js",
    "build-cli": "rollup -c rollup.config.cli.js",
    "build-all": "npm run build-cli && npm run build-module && npm run build-web && npm run build-min && npm run build-opt",
    "start-dev": "budo src/ui/index.js:dist/index.js --port=8080 --live -- -b -t babelify",
    "release-patch": "git checkout master; npm run build-all && npm version patch && npm run build-all; git commit -a -m 'chore(dist): built dist/'; git push origin master --tags ",
    "release-minor": "git checkout master; npm run build-all && npm version minor && npm run build-all; git commit -a -m 'chore(dist): built dist/'; git push origin master --tags ",
    "release-major": "git checkout master; npm run build-all && npm version major && npm run build-all; git commit -a -m 'chore(dist): built dist/'; git push origin master --tags "
  },
  "contributors": [
    {
      "name": "Rene K. Mueller",
      "url": "http://renekmueller.com"
    },
    {
      "name": "z3dev",
      "url": "http://www.z3d.jp"
    },
    {
      "name": "Mark 'kaosat-dev' Moissette",
      "url": "http://kaosat.net"
    }
  ],
  "license": "MIT",
  "dependencies": {
    "@jscad/csg": "^0.1.4",
    "@jscad/io": "^0.1.0",
    "@jscad/scad-api": "^0.2.0",
    "brace": "^0.9.0",
    "hammerjs": "^2.0.8",
    "openscad-openjscad-translator": "github:jscad/openscad-openjscad-translator",
    "webworkify": "^1.4.0"
  },
  "devDependencies": {
    "ava": "^0.15.2",
    "babel-cli": "^6.6.5",
    "babel-core": "^6.2.1",
    "babel-preset-es2015": "^6.1.18",
    "babelify": "^7.2.0",
    "browserify": "^13.0.0",
    "browserify-shim": "^3.8.12",
    "budo": "^8.3.0",
    "minifyify": "^7.3.3",
    "rollup": "^0.38.0",
    "rollup-plugin-buble": "^0.15.0",
    "rollup-plugin-commonjs": "^6.0.1",
    "rollup-plugin-node-resolve": "^2.0.0",
    "rollup-plugin-post-replace": "^1.0.0"
  },
  "browserify": {
    "transform": [
      "browserify-shim"
    ]
  },
  "browserify-shim": {}
}

},{}],36:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.convertToBlob = convertToBlob;

var _csg = require('@jscad/csg');

var _io = require('@jscad/io');

var _misc = require('../utils/misc');

/*import CSGToStla from '@jscad/io/writers/CSGToStla'
import CSGToStlb from '@jscad/io/writers/CSGToStlb'
import CSGToAMF from '@jscad/io/writers/CSGToAMF'
import CSGToX3D from '@jscad/io/writers/CSGToX3D'
import CAGToSvg from '@jscad/io/writers/CAGToSvg'
import CAGToJson from '@jscad/io/writers/CAGToJson'
import CAGToDxf from '@jscad/io/writers/CAGToDxf'*/
var Blob = (0, _io.makeBlob)();

function convertToBlob(objects, params) {
  var format = params.format,
      formatInfo = params.formatInfo,
      _params$version = params.version,
      version = _params$version === undefined ? '0.0.0' : _params$version;


  var object = void 0;

  if (format === 'jscad') {
    object = objects;
  } else {
    objects = (0, _misc.toArray)(objects);
    // console.log('convertToBlob', objects, format)
    // console.log('object', objects[0], objects[0] instanceof CSG)

    // review the given objects
    var foundCSG = false;
    var foundCAG = false;
    for (var i = 0; i < objects.length; i++) {
      if (objects[i] instanceof _csg.CSG) {
        foundCSG = true;
      }
      if (objects[i] instanceof _csg.CAG) {
        foundCAG = true;
      }
    }
    // convert based on the given format
    foundCSG = foundCSG && formatInfo.convertCSG;
    foundCAG = foundCAG && formatInfo.convertCAG;
    if (foundCSG && foundCAG) {
      foundCAG = false;
    } // use 3D conversion

    object = !foundCSG ? new _csg.CAG() : new _csg.CSG();

    for (var _i = 0; _i < objects.length; _i++) {
      if (foundCSG === true && objects[_i] instanceof _csg.CAG) {
        object = object.union(objects[_i].extrude({ offset: [0, 0, 0.1] })); // convert CAG to a thin solid CSG
        continue;
      }
      if (foundCAG === true && objects[_i] instanceof _csg.CSG) {
        continue;
      }
      object = object.union(objects[_i]);
    }
  }

  var meta = {
    producer: 'OpenJSCAD.org ' + version,
    date: new Date()
  };

  var outputFormatHandlers = {
    amf: function amf(object) {
      return (0, _io.CSGToAMF)(object, meta);
    }, // CSG to AMF
    stl: function stl(object) {
      return (0, _io.CSGToStla)(object, { version: version });
    }, // CSG to STL ASCII
    stla: function stla(object) {
      return (0, _io.CSGToStla)(object, { version: version });
    }, // CSG to STL ASCII
    stlb: function stlb(object) {
      return (0, _io.CSGToStlb)(object, { webBlob: true, version: version });
    }, // CSG to STL BINARY
    dxf: function dxf(object) {
      return (0, _io.CAGToDxf)(object, { version: version });
    }, // CAG to DXF
    svg: function svg(object) {
      return (0, _io.CAGToSvg)(object, { version: version });
    }, // CAG to SVG
    x3d: function x3d(object) {
      return (0, _io.CSGToX3D)(object.fixTJunctions(), { version: version });
    },
    json: function json(object) {
      return (0, _io.CAGToJson)(object, { version: version });
    }, // CSG or CAG to JSON
    js: function js(object) {
      return object;
    }, // js , pass through
    jscad: function jscad(object) {
      return object;
    }, // jscad, pass through
    undefined: function undefined() {
      throw new Error('Not supported : only jscad, stl, amf, dxf, svg or json as output format');
    }
  };

  var blob = outputFormatHandlers[format](object);

  if (format === 'jscad') {
    blob = new Blob([blob], { type: formatInfo.mimetype });
  }
  return blob;
}

},{"../utils/misc":59,"@jscad/csg":1,"@jscad/io":2}],37:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var formats = exports.formats = {
  stl: { displayName: 'STL (ASCII)', description: 'STereoLithography, ASCII', extension: 'stl', mimetype: 'application/sla', convertCSG: true, convertCAG: false },
  stla: { displayName: 'STL (ASCII)', description: 'STereoLithography, ASCII', extension: 'stl', mimetype: 'application/sla', convertCSG: true, convertCAG: false },
  stlb: { displayName: 'STL (Binary)', description: 'STereoLithography, Binary', extension: 'stl', mimetype: 'application/sla', convertCSG: true, convertCAG: false },
  amf: { displayName: 'AMF (experimental)', description: 'Additive Manufacturing File Format', extension: 'amf', mimetype: 'application/amf+xml', convertCSG: true, convertCAG: false },
  x3d: { displayName: 'X3D', description: 'X3D File Format', extension: 'x3d', mimetype: 'model/x3d+xml', convertCSG: true, convertCAG: false },
  dxf: { displayName: 'DXF', description: 'AutoCAD Drawing Exchange Format', extension: 'dxf', mimetype: 'application/dxf', convertCSG: false, convertCAG: true },
  jscad: { displayName: 'JSCAD', description: 'OpenJSCAD.org Source', extension: 'jscad', mimetype: 'application/javascript', convertCSG: true, convertCAG: true },
  svg: { displayName: 'SVG', description: 'Scalable Vector Graphics Format', extension: 'svg', mimetype: 'image/svg+xml', convertCSG: false, convertCAG: true },
  js: { displayName: 'js', description: 'JavaScript Source' },
  gcode: { displayName: 'gcode', description: 'G Programming Language File Format' },
  json: { displayName: 'json', description: 'JavaScript Object Notation Format' }
};

},{}],38:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = convertToSolid;

var _csg = require('@jscad/csg');

// FIXME: is there not too much overlap with convertToBlob ?
function convertToSolid(objects) {
  if (objects.length === undefined) {
    if (objects instanceof _csg.CAG || objects instanceof _csg.CSG) {
      var obj = objects;
      objects = [obj];
    } else {
      throw new Error('Cannot convert object (' + (typeof objects === 'undefined' ? 'undefined' : _typeof(objects)) + ') to solid');
    }
  }

  var solid = null;
  for (var i = 0; i < objects.length; i++) {
    var _obj = objects[i];
    if (_obj instanceof _csg.CAG) {
      _obj = _obj.extrude({ offset: [0, 0, 0.1] }); // convert CAG to a thin solid CSG
    }
    if (solid !== null) {
      solid = solid.unionForNonIntersecting(_obj);
    } else {
      solid = _obj;
    }
  }
  return solid;
}

},{"@jscad/csg":1}],39:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = generateOutputFileBlobUrl;

var _detectBrowser = require('../ui/detectBrowser');

var _urlHelpers = require('../ui/urlHelpers');

function generateOutputFileBlobUrl(extension, blob, callback) {
  if ((0, _detectBrowser.isSafari)()) {
    // console.log("Trying download via DATA URI")
    // convert BLOB to DATA URI
    var reader = new FileReader();
    reader.onloadend = function () {
      if (reader.result) {
        callback(reader.result, 'openjscad.' + extension, true, true);
      }
    };
    reader.readAsDataURL(blob);
  } else {
    // console.log("Trying download via BLOB URL")
    // convert BLOB to BLOB URL (HTML5 Standard)
    var windowURL = (0, _urlHelpers.getWindowURL)();
    var outputFileBlobUrl = windowURL.createObjectURL(blob);
    if (!outputFileBlobUrl) throw new Error('createObjectURL() failed');
    callback(outputFileBlobUrl, 'openjscad.' + extension, true, false);
  }
}

},{"../ui/detectBrowser":50,"../ui/urlHelpers":54}],40:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = generateOutputFileFileSystem;

var _fileSystemApiErrorHandler = require('../ui/fileSystemApiErrorHandler');

var _fileSystemApiErrorHandler2 = _interopRequireDefault(_fileSystemApiErrorHandler);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function generateOutputFileFileSystem(extension, blob, callback) {
  var request = window.requestFileSystem || window.webkitRequestFileSystem;
  if (!request) {
    throw new Error('Your browser does not support the HTML5 FileSystem API. Please try the Chrome browser instead.');
  }
  // console.log("Trying download via FileSystem API")
  // create a random directory name:
  var dirname = 'OpenJsCadOutput1_' + parseInt(Math.random() * 1000000000, 10) + '_' + extension;
  var filename = 'output.' + extension; // FIXME this should come from this.filename
  request(TEMPORARY, 20 * 1024 * 1024, function (fs) {
    fs.root.getDirectory(dirname, { create: true, exclusive: true }, function (dirEntry) {
      dirEntry.getFile(filename, { create: true, exclusive: true }, function (fileEntry) {
        fileEntry.createWriter(function (fileWriter) {
          fileWriter.onwriteend = function (e) {
            callback(fileEntry.toURL(), fileEntry.name);
          };
          fileWriter.onerror = function (e) {
            throw new Error('Write failed: ' + e.toString());
          };
          fileWriter.write(blob);
        }, function (fileerror) {
          (0, _fileSystemApiErrorHandler2.default)(fileerror, 'createWriter');
        });
      }, function (fileerror) {
        (0, _fileSystemApiErrorHandler2.default)(fileerror, "getFile('" + filename + "')");
      });
    }, function (fileerror) {
      (0, _fileSystemApiErrorHandler2.default)(fileerror, "getDirectory('" + dirname + "')");
    });
  }, function (fileerror) {
    (0, _fileSystemApiErrorHandler2.default)(fileerror, 'requestFileSystem');
  });
}

},{"../ui/fileSystemApiErrorHandler":52}],41:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = getParamDefinitions;
// parse the jscad script to get the parameter definitions
function getParamDefinitions(script) {
  var scriptisvalid = true;
  script += '\nfunction include() {}'; // at least make it not throw an error so early
  try {
    // first try to execute the script itself
    // this will catch any syntax errors
    //    BUT we can't introduce any new function!!!
    new Function(script)();
  } catch (e) {
    scriptisvalid = false;
    throw e;
  }
  var params = [];
  if (scriptisvalid) {
    var script1 = "if(typeof(getParameterDefinitions) == 'function') {return getParameterDefinitions();} else {return [];} ";
    script1 += script;
    var f = new Function(script1);
    params = f();
    if ((typeof params === 'undefined' ? 'undefined' : _typeof(params)) !== 'object' || typeof params.length !== 'number') {
      throw new Error('The getParameterDefinitions() function should return an array with the parameter definitions');
    }
  }
  return params;
}

},{}],42:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getParamValues;
function getParamValues(paramControls, onlyChanged) {
  var paramValues = {};
  var value;
  for (var i = 0; i < paramControls.length; i++) {
    var control = paramControls[i];
    switch (control.paramType) {
      case 'choice':
        value = control.options[control.selectedIndex].value;
        break;
      case 'float':
      case 'number':
        var value = control.value;
        if (!isNaN(parseFloat(value)) && isFinite(value)) {
          value = parseFloat(value);
        } else {
          throw new Error('Parameter (' + control.paramName + ') is not a valid number (' + value + ')');
        }
        break;
      case 'int':
        var value = control.value;
        if (!isNaN(parseFloat(value)) && isFinite(value)) {
          value = parseInt(value);
        } else {
          throw new Error('Parameter (' + control.paramName + ') is not a valid number (' + value + ')');
        }
        break;
      case 'checkbox':
      case 'radio':
        if (control.checked === true && control.value.length > 0) {
          value = control.value;
        } else {
          value = control.checked;
        }
        break;
      default:
        value = control.value;
        break;
    }
    if (onlyChanged) {
      if ('initial' in control && control.initial == value) {
        continue;
      } else if ('default' in control && control.default == value) {
        continue;
      }
    }
    paramValues[control.paramName] = value;
    // console.log(control.paramName+":"+paramValues[control.paramName])
  }
  return paramValues;
}

},{}],43:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = includeJscadSync;
// THESE FUNCTIONS ARE SERIALIZED FOR INCLUSION IN THE FULL SCRIPT
// TODO It might be possible to cache the serialized versions

// Include the requested script via MemFs (if available) or HTTP Request
// (Note: This function is appended together with the JSCAD script)

function includeJscadSync(relpath, scriptPath, memFs) {
  // console.log('include', relpath, scriptPath)
  // include the requested script via MemFs if possible
  return new Promise(function (resolve, reject) {
    if ((typeof memFs === 'undefined' ? 'undefined' : _typeof(memFs)) === 'object') {
      for (var fs in memFs) {
        if (memFs[fs].fullpath === scriptPath || './' + memFs[fs].fullpath === scriptPath || memFs[fs].name === scriptPath) {
          resolve(memFs[fs].source);
          return;
        }
      }
    }
    // include the requested script via webserver access
    var xhr = new XMLHttpRequest();
    var url = relpath + scriptPath;
    if (scriptPath.match(/^(https:|http:)/i)) {
      url = scriptPath;
    }
    xhr.open('GET', url, false);
    xhr.onload = function () {
      var src = this.responseText;
      resolve(src);
    };
    xhr.onerror = function (err) {
      return reject(err);
    };
    xhr.send();
  });
}

},{}],44:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = createJscadFunction;
// == OpenJSCAD.org, Copyright (c) 2013-2016, Licensed under MIT License
//
// History:
//   2016/02/02: 0.4.0: GUI refactored, functionality split up into more files, mostly done by Z3 Dev

/**
 * Create an function for processing the JSCAD script into CSG/CAG objects
 * @param {String} script the script
 * @param {Object} globals the globals to use when evaluating the script: these are not ..
 * ...ACTUAL globals, merely functions/ variable accessible AS IF they were globals !
 */
function createJscadFunction(script, globals) {
  // console.log('globals', globals)
  // not a fan of this, we have way too many explicit api elements
  var globalsList = '';
  // each top key is a library ie : openscad helpers etc
  // one level below that is the list of libs
  // last level is the actual function we want to export to 'local' scope
  Object.keys(globals).forEach(function (libKey) {
    var lib = globals[libKey];
    // console.log(`lib:${libKey}: ${lib}`)
    Object.keys(lib).forEach(function (libItemKey) {
      var libItems = lib[libItemKey];
      // console.log('libItems', libItems)
      Object.keys(libItems).forEach(function (toExposeKey) {
        // console.log('toExpose',toExpose )
        var text = 'const ' + toExposeKey + ' = globals[\'' + libKey + '\'][\'' + libItemKey + '\'][\'' + toExposeKey + '\']\n';
        globalsList += text;
      });
    });
  });

  var source = '// SYNC WORKER\n    ' + globalsList + '\n\n    //user defined script(s)\n    ' + script + '\n\n    if (typeof (main) !== \'function\') {\n      throw new Error(\'The JSCAD script must contain a function main() which returns one or more CSG or CAG solids.\')\n    }\n\n    return main(params)\n  ';

  var f = new Function('params', 'include', 'globals', source);
  return f;
}

},{}],45:[function(require,module,exports){
'use strict';

var _csg = require('@jscad/csg');

var _scadApi = require('@jscad/scad-api');

var _scadApi2 = _interopRequireDefault(_scadApi);

var _jscadFunction = require('./jscad-function');

var _jscadFunction2 = _interopRequireDefault(_jscadFunction);

var _misc = require('../utils/misc');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// jscad-worker.js
//
// == OpenJSCAD.org, Copyright (c) 2013-2016, Licensed under MIT License
//
// History:
//   2016/02/02: 0.4.0: GUI refactored, functionality split up into more files, mostly done by Z3 Dev

// Create an worker (thread) for processing the JSCAD script into CSG/CAG objects

module.exports = function (self) {
  self.onmessage = function (e) {
    var r = { cmd: 'error', txt: 'try again' };
    if (e.data instanceof Object) {
      var data = e.data;
      if (data.cmd === 'render') {
        var _e$data = e.data,
            script = _e$data.script,
            parameters = _e$data.parameters,
            options = _e$data.options;


        var globals = options.implicitGlobals ? { oscad: _scadApi2.default } : {};
        var func = (0, _jscadFunction2.default)(script, globals);
        var objects = func(parameters, function (x) {
          return x;
        }, globals);
        objects = (0, _misc.toArray)(objects).map(function (object) {
          if (object instanceof _csg.CAG || object instanceof _csg.CSG) {
            return object.toCompactBinary();
          }
        });

        if (objects.length === 0) {
          throw new Error('The JSCAD script must return one or more CSG or CAG solids.');
        }
        self.postMessage({ cmd: 'rendered', objects: objects });
      }
    }
  };
};

},{"../utils/misc":59,"./jscad-function":44,"@jscad/csg":1,"@jscad/scad-api":3}],46:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.log = log;
exports.status = status;
function log(txt) {
  var timeInMs = Date.now();
  var prevtime = undefined; //OpenJsCad.log.prevLogTime
  if (!prevtime) prevtime = timeInMs;
  var deltatime = timeInMs - prevtime;
  log.prevLogTime = timeInMs;
  var timefmt = (deltatime * 0.001).toFixed(3);
  txt = '[' + timefmt + '] ' + txt;
  if ((typeof console === 'undefined' ? 'undefined' : _typeof(console)) == 'object' && typeof console.log == 'function') {
    console.log(txt);
  } else if ((typeof self === 'undefined' ? 'undefined' : _typeof(self)) == 'object' && typeof self.postMessage == 'function') {
    self.postMessage({ cmd: 'log', txt: txt });
  } else throw new Error('Cannot log');
}

// See Processor.setStatus()
// Note: leave for compatibility
function status(s) {
  log(s);
}

},{}],47:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = Processor;

var _io = require('@jscad/io');

var _csg = require('@jscad/csg');

var _log = require('./log');

var _log2 = _interopRequireDefault(_log);

var _getParamDefinitions = require('./getParamDefinitions');

var _getParamDefinitions2 = _interopRequireDefault(_getParamDefinitions);

var _getParamValues = require('./getParamValues');

var _getParamValues2 = _interopRequireDefault(_getParamValues);

var _convertToSolid = require('./convertToSolid');

var _convertToSolid2 = _interopRequireDefault(_convertToSolid);

var _rebuildSolid = require('./rebuildSolid');

var _generateOutputFileBlobUrl = require('./generateOutputFileBlobUrl');

var _generateOutputFileBlobUrl2 = _interopRequireDefault(_generateOutputFileBlobUrl);

var _generateOutputFileFileSystem = require('./generateOutputFileFileSystem');

var _generateOutputFileFileSystem2 = _interopRequireDefault(_generateOutputFileFileSystem);

var _jscadViewer = require('../ui/viewer/jscad-viewer');

var _jscadViewer2 = _interopRequireDefault(_jscadViewer);

var _convertToBlob = require('../io/convertToBlob');

var _formats = require('../io/formats');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/*
 * exposes the properties of an object to the given scope object (for example WINDOW etc)
 * this is the same as {foo, bar} = baz
 * window.bar = bar
 * window.foo = foo
*/
function exposeAPI(object) {
  var scope = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : window;

  Object.keys(object).forEach(function (key) {
    scope[key] = object[key];
  });
}

/* exposeAPI({OpenJsCad})// for backwards compatibility only
exposeAPI(primitives2d)
exposeAPI(primitives3d)
exposeAPI(booleanOps)
exposeAPI(transformations)
exposeAPI(extrusion)
exposeAPI(color)
exposeAPI(maths)
exposeAPI(text)
exposeAPI(csg) */

// output handling
function Processor(containerdiv, options) {
  if (options === undefined) options = {};
  // the default options
  this.opts = {
    debug: false,
    libraries: ['js/lib/csg.js', 'js/formats.js', 'js/js', 'js/openscad.js'],
    openJsCadPath: '',
    useAsync: true,
    useSync: true,
    viewer: {}
  };
  // apply all options found
  for (var x in this.opts) {
    if (x in options) this.opts[x] = options[x];
  }

  this.containerdiv = containerdiv;

  this.viewer = null;
  this.builder = null;
  this.zoomControl = null;

  // callbacks
  this.onchange = null; // function(Processor) for callback
  this.ondownload = null; // function(Processor) for callback

  this.currentObjects = []; // list of objects returned from rebuildObject*
  this.viewedObject = null; // the object being rendered

  this.selectStartPoint = 0;
  this.selectEndPoint = 0;

  this.hasOutputFile = false;
  this.hasError = false;
  this.paramDefinitions = [];
  this.paramControls = [];
  this.script = null;
  this.formats = _formats.formats;

  this.baseurl = document.location.href;
  this.baseurl = this.baseurl.replace(/#.*$/, ''); // remove remote URL
  this.baseurl = this.baseurl.replace(/\?.*$/, ''); // remove parameters
  if (this.baseurl.lastIndexOf('/') !== this.baseurl.length - 1) {
    this.baseurl = this.baseurl.substring(0, this.baseurl.lastIndexOf('/') + 1);
  }

  // state of the processor
  // 0 - initialized - no viewer, no parameters, etc
  // 1 - processing  - processing JSCAD script
  // 2 - complete    - completed processing
  // 3 - incomplete  - incompleted due to errors in processing
  this.state = 0; // initialized

  // FIXME: UI only, seperate
  this.createElements();
}

Processor.convertToSolid = _convertToSolid2.default;

Processor.prototype = {
  createElements: function createElements() {
    var that = this; // for event handlers

    while (this.containerdiv.children.length > 0) {
      this.containerdiv.removeChild(0);
    }

    var viewerdiv = document.createElement('div');
    viewerdiv.className = 'viewer';
    viewerdiv.style.width = '100%';
    viewerdiv.style.height = '100%';
    this.containerdiv.appendChild(viewerdiv);
    try {
      this.viewer = new _jscadViewer2.default(viewerdiv, this.opts.viewer);
    } catch (e) {
      viewerdiv.innerHTML = '<b><br><br>Error: ' + e.toString() + '</b><br><br>A browser with support for WebGL is required';
    }
    // Zoom control
    if (0) {
      // FIXME: what the heck ?
      var div = document.createElement('div');
      this.zoomControl = div.cloneNode(false);
      this.zoomControl.style.width = this.viewerwidth + 'px';
      this.zoomControl.style.height = '20px';
      this.zoomControl.style.backgroundColor = 'transparent';
      this.zoomControl.style.overflowX = 'scroll';
      div.style.width = this.viewerwidth * 11 + 'px';
      div.style.height = '1px';
      this.zoomControl.appendChild(div);
      this.zoomChangedBySlider = false;
      this.zoomControl.onscroll = function (event) {
        var zoom = that.zoomControl;
        var newzoom = zoom.scrollLeft / (10 * zoom.offsetWidth);
        that.zoomChangedBySlider = true; // prevent recursion via onZoomChanged
        that.viewer.setZoom(newzoom);
        that.zoomChangedBySlider = false;
      };
      this.viewer.onZoomChanged = function () {
        if (!that.zoomChangedBySlider) {
          var newzoom = that.viewer.getZoom();
          that.zoomControl.scrollLeft = newzoom * (10 * that.zoomControl.offsetWidth);
        }
      };

      this.containerdiv.appendChild(this.zoomControl);
      this.zoomControl.scrollLeft = this.viewer.viewpointZ / this.viewer.camera.clip.max * (this.zoomControl.scrollWidth - this.zoomControl.offsetWidth);

      // end of zoom control
    }

    this.selectdiv = this.containerdiv.parentElement.querySelector('div#selectdiv');
    if (!this.selectdiv) {
      this.selectdiv = document.createElement('div');
      this.selectdiv.id = 'selectdiv';
      this.containerdiv.parentElement.appendChild(this.selectdiv);
    }
    var element = document.createElement('input');
    element.setAttribute('type', 'range');
    element.id = 'startRange';
    element.min = 0;
    element.max = 100;
    element.step = 1;
    element.oninput = function (e) {
      if (that.state === 2) {
        that.updateView();
        that.updateFormats();
        that.updateDownloadLink();
      }
    };
    this.selectdiv.appendChild(element);
    element = document.createElement('input');
    element.setAttribute('type', 'range');
    element.id = 'endRange';
    element.min = 0;
    element.max = 100;
    element.step = 1;
    element.oninput = function (e) {
      if (that.state === 2) {
        that.updateView();
        that.updateFormats();
        that.updateDownloadLink();
      }
    };
    this.selectdiv.appendChild(element);

    this.errordiv = this.containerdiv.parentElement.querySelector('div#errordiv');
    if (!this.errordiv) {
      this.errordiv = document.createElement('div');
      this.errordiv.id = 'errordiv';
      this.containerdiv.parentElement.appendChild(this.errordiv);
    }
    this.errorpre = document.createElement('pre');
    this.errordiv.appendChild(this.errorpre);

    this.statusdiv = this.containerdiv.parentElement.querySelector('div#statusdiv');
    if (!this.statusdiv) {
      this.statusdiv = document.createElement('div');
      this.statusdiv.id = 'statusdiv';
      this.containerdiv.parentElement.appendChild(this.statusdiv);
    }
    this.statusspan = document.createElement('span');
    this.statusspan.id = 'statusspan';
    this.statusbuttons = document.createElement('span');
    this.statusbuttons.id = 'statusbuttons';
    this.statusdiv.appendChild(this.statusspan);
    this.statusdiv.appendChild(this.statusbuttons);
    this.abortbutton = document.createElement('button');
    this.abortbutton.innerHTML = 'Abort';
    this.abortbutton.onclick = function (e) {
      that.abort();
    };
    this.statusbuttons.appendChild(this.abortbutton);
    this.formatDropdown = document.createElement('select');
    this.formatDropdown.onchange = function (e) {
      that.currentFormat = that.formatDropdown.options[that.formatDropdown.selectedIndex].value;
      that.updateDownloadLink();
    };
    this.statusbuttons.appendChild(this.formatDropdown);
    this.generateOutputFileButton = document.createElement('button');
    this.generateOutputFileButton.onclick = function (e) {
      that.generateOutputFile();
    };
    this.statusbuttons.appendChild(this.generateOutputFileButton);
    this.downloadOutputFileLink = document.createElement('a');
    this.downloadOutputFileLink.className = 'downloadOutputFileLink'; // so we can css it
    this.statusbuttons.appendChild(this.downloadOutputFileLink);

    this.parametersdiv = this.containerdiv.parentElement.querySelector('div#parametersdiv');
    if (!this.parametersdiv) {
      this.parametersdiv = document.createElement('div');
      this.parametersdiv.id = 'parametersdiv';
      this.containerdiv.parentElement.appendChild(this.parametersdiv);
    }
    this.parameterstable = document.createElement('table');
    this.parameterstable.className = 'parameterstable';
    this.parametersdiv.appendChild(this.parameterstable);

    element = this.parametersdiv.querySelector('button#updateButton');
    if (element === null) {
      element = document.createElement('button');
      element.innerHTML = 'Update';
      element.id = 'updateButton';
    }
    element.onclick = function (e) {
      that.rebuildSolid();
    };
    this.parametersdiv.appendChild(element);

    // implementing instantUpdate
    var instantUpdateCheckbox = document.createElement('input');
    instantUpdateCheckbox.type = 'checkbox';
    instantUpdateCheckbox.id = 'instantUpdate';
    this.parametersdiv.appendChild(instantUpdateCheckbox);

    element = document.getElementById('instantUpdateLabel');
    if (element === null) {
      element = document.createElement('label');
      element.innerHTML = 'Instant Update';
      element.id = 'instantUpdateLabel';
    }
    element.setAttribute('for', instantUpdateCheckbox.id);
    this.parametersdiv.appendChild(element);

    this.enableItems();
    this.clearViewer();
  },

  setCurrentObjects: function setCurrentObjects(objs) {
    if (!(length in objs)) {
      objs = [objs]; // create a list
    }
    this.currentObjects = objs; // list of CAG or CSG objects

    this.updateSelection();
    this.selectStartPoint = -1; // force view update
    this.updateView();
    this.updateFormats();
    this.updateDownloadLink();

    if (this.onchange) this.onchange(this);
  },

  selectedFormat: function selectedFormat() {
    return this.formatDropdown.options[this.formatDropdown.selectedIndex].value;
  },

  selectedFormatInfo: function selectedFormatInfo() {
    return this.formatInfo(this.selectedFormat());
  },

  updateDownloadLink: function updateDownloadLink() {
    var info = this.selectedFormatInfo();
    var ext = info.extension;
    this.generateOutputFileButton.innerHTML = 'Generate ' + ext.toUpperCase();
  },

  updateSelection: function updateSelection() {
    var range = document.getElementById('startRange');
    range.min = 0;
    range.max = this.currentObjects.length - 1;
    range.value = 0;
    range = document.getElementById('endRange');
    range.min = 0;
    range.max = this.currentObjects.length - 1;
    range.value = this.currentObjects.length - 1;
  },

  updateView: function updateView() {
    var startpoint = parseInt(document.getElementById('startRange').value, 10);
    var endpoint = parseInt(document.getElementById('endRange').value, 10);
    if (startpoint === this.selectStartPoint && endpoint === this.selectEndPoint) {
      return;
    }

    // build a list of objects to view
    this.selectStartPoint = startpoint;
    this.selectEndPoint = endpoint;
    if (startpoint > endpoint) {
      startpoint = this.selectEndPoint;endpoint = this.selectStartPoint;
    }

    var objs = this.currentObjects.slice(startpoint, endpoint + 1);
    this.viewedObject = (0, _convertToSolid2.default)(objs); // enforce CSG to display

    if (this.viewer) {
      this.viewer.setCsg(this.viewedObject);
    }
  },

  updateFormats: function updateFormats() {
    while (this.formatDropdown.options.length > 0) {
      this.formatDropdown.options.remove(0);
    }

    var that = this;
    var formats = this.supportedFormatsForCurrentObjects();
    formats.forEach(function (format) {
      var option = document.createElement('option');
      var info = that.formatInfo(format);
      option.setAttribute('value', format);
      option.appendChild(document.createTextNode(info.displayName));
      that.formatDropdown.options.add(option);
    });
  },

  clearViewer: function clearViewer() {
    this.clearOutputFile();
    if (this.viewedObject) {
      this.viewer.clear();
      this.viewedObject = null;
      if (this.onchange) this.onchange(this);
    }
    this.enableItems();
  },

  abort: function abort() {
    // abort if state is processing
    if (this.state === 1) {
      // todo: abort
      this.setStatus('aborted');
      this.builder.cancel();
      this.state = 3; // incomplete
      this.enableItems();
      if (this.onchange) this.onchange(this);
    }
  },

  enableItems: function enableItems() {
    this.abortbutton.style.display = this.state === 1 ? 'inline' : 'none';
    this.formatDropdown.style.display = !this.hasOutputFile && this.viewedObject ? 'inline' : 'none';
    this.generateOutputFileButton.style.display = !this.hasOutputFile && this.viewedObject ? 'inline' : 'none';
    this.downloadOutputFileLink.style.display = this.hasOutputFile ? 'inline' : 'none';
    this.parametersdiv.style.display = this.paramControls.length > 0 ? 'inline-block' : 'none'; // was 'block'
    this.errordiv.style.display = this.hasError ? 'block' : 'none';
    this.statusdiv.style.display = this.hasError ? 'none' : 'block';
    this.selectdiv.style.display = this.currentObjects.length > 1 ? 'none' : 'none'; // FIXME once there's a data model
  },

  setMemfs: function setMemfs(memFs) {
    this.memFs = memFs;
  },

  setDebugging: function setDebugging(debugging) {
    this.opts.debug = debugging;
  },

  addLibrary: function addLibrary(lib) {
    this.opts['libraries'].push(lib);
  },

  setOpenJsCadPath: function setOpenJsCadPath(path) {
    this.opts['openJsCadPath'] = path;
  },

  setError: function setError(txt) {
    this.hasError = txt != '';
    this.errorpre.textContent = txt;
    this.enableItems();
  },

  // set status and data to display
  setStatus: function setStatus(status, data) {
    if (typeof document !== 'undefined') {
      var statusMap = {
        error: data,
        ready: 'Ready',
        aborted: 'Aborted.',
        busy: data + ' <img id=busy src=\'imgs/busy.gif\'>',
        loading: 'Loading ' + data + ' <img id=busy src=\'imgs/busy.gif\'>',
        loaded: data,
        saving: data,
        saved: data,
        converting: 'Converting ' + data + ' <img id=busy src=\'imgs/busy.gif\'>',
        fetching: 'Fetching ' + data + ' <img id=busy src=\'imgs/busy.gif\'>',
        rendering: 'Rendering. Please wait <img id=busy src=\'imgs/busy.gif\'>'
      };
      var content = statusMap[status] ? statusMap[status] : data;
      if (status === 'error') {
        this.setError(data);
      }

      this.statusspan.innerHTML = content;
    } else {
      (0, _log2.default)(data);
    }
  },

  // script: javascript code
  // filename: optional, the name of the .jscad file
  setJsCad: function setJsCad(script, filename) {
    // console.log('setJsCad', script, filename)
    if (!filename) filename = 'openjscad.jscad';

    var prevParamValues = {};
    // this will fail without existing form
    try {
      prevParamValues = (0, _getParamValues2.default)(this.paramControls, /*onlyChanged*/true);
    } catch (e) {}

    this.abort();
    this.paramDefinitions = [];

    this.script = null;
    this.setError('');

    var scripthaserrors = false;
    try {
      this.paramDefinitions = (0, _getParamDefinitions2.default)(script);
      this.paramControls = [];
      this.createParamControls(prevParamValues);
    } catch (e) {
      this.setStatus('error', e.toString());
      scripthaserrors = true;
    }
    if (!scripthaserrors) {
      this.script = script;
      this.filename = filename;
      this.rebuildSolid();
    } else {
      this.enableItems();
    }
  },

  // FIXME: not needed anymore, file cache is handled elsewhere
  getFullScript: function getFullScript() {
    return this.script;
    /*var script = ''
    // add the file cache
     script += 'var gMemFs = ['
    if (typeof (this.memFs) === 'object') {
      var comma = ''
      for (var fn in this.memFs) {
        script += comma
        script += JSON.stringify(this.memFs[fn])
        comma = ','
      }
    }
    script += '];\n'
    script += '\n'
    // add the main script
    script += this.script
    return script*/
  },

  rebuildSolid: function rebuildSolid() {
    var _this = this;

    // clear previous solid and settings
    this.abort();
    this.setError('');
    this.clearViewer();
    this.enableItems();
    this.setStatus('rendering');

    // rebuild the solid

    // prepare all parameters
    var parameters = (0, _getParamValues2.default)(this.paramControls);
    var script = this.getFullScript();
    var fullurl = this.baseurl + this.filename;
    var options = { memFs: this.memFs };

    this.state = 1; // processing
    var that = this;
    function callback(err, objects) {
      if (err) {
        if (err.stack) {
          var errtxt = '';
          errtxt += '\nStack trace:\n' + err.stack;
          //    var errtxt = err.toString()
        }
        that.setStatus('error', err); // 'Error.'
        that.state = 3; // incomplete
      } else {
        that.setCurrentObjects(objects);
        that.setStatus('ready');
        that.state = 2; // complete
      }
      that.enableItems();
    }

    if (this.opts.useAsync) {
      this.builder = (0, _rebuildSolid.rebuildSolidAsync)(script, fullurl, parameters, function (err, objects) {
        if (err && that.opts.useSync) {
          _this.builder = (0, _rebuildSolid.rebuildSolidSync)(script, fullurl, parameters, callback, options);
        } else callback(undefined, objects);
      }, options);
    } else if (this.opts.useSync) {
      this.builder = (0, _rebuildSolid.rebuildSolidSync)(script, fullurl, parameters, callback, options);
    }
  },

  getState: function getState() {
    return this.state;
  },

  clearOutputFile: function clearOutputFile() {
    if (this.hasOutputFile) {
      this.hasOutputFile = false;
      if (this.outputFileDirEntry) {
        this.outputFileDirEntry.removeRecursively(function () {});
        this.outputFileDirEntry = null;
      }
      if (this.outputFileBlobUrl) {
        (0, _io.revokeBlobUrl)(this.outputFileBlobUrl);
        this.outputFileBlobUrl = null;
      }
      this.enableItems();
    }
  },

  generateOutputFile: function generateOutputFile() {
    this.clearOutputFile();
    var blob = this.currentObjectsToBlob();
    var extension = this.selectedFormatInfo().extension;
    console.log('generateOutputFile');

    function onDone(data, downloadAttribute, blobMode, noData) {
      this.hasOutputFile = true;
      this.downloadOutputFileLink.href = data;
      if (blobMode) {
        this.outputFileBlobUrl = data;
      } else {}
      // FIXME: what to do with this one ?
      // that.outputFileDirEntry = dirEntry // save for later removal

      // this.downloadOutputFileLink.type = this.selectedFormatInfo().mimetype

      this.downloadOutputFileLink.innerHTML = this.downloadLinkTextForCurrentObject();
      this.downloadOutputFileLink.setAttribute('download', downloadAttribute);
      if (noData) {
        this.downloadOutputFileLink.setAttribute('target', '_blank');
      }
      this.enableItems();
    }

    if (this.viewedObject) {
      try {
        // this.generateOutputFileFileSystem()
        (0, _generateOutputFileFileSystem2.default)(extension, blob, onDone.bind(this));
      } catch (e) {
        // this.generateOutputFileBlobUrl()
        (0, _generateOutputFileBlobUrl2.default)(extension, blob, onDone.bind(this));
      }
      if (this.ondownload) this.ondownload(this);
    }
  },

  currentObjectsToBlob: function currentObjectsToBlob() {
    var startpoint = this.selectStartPoint;
    var endpoint = this.selectEndPoint;
    if (startpoint > endpoint) {
      startpoint = this.selectEndPoint;endpoint = this.selectStartPoint;
    }

    var format = this.selectedFormat();
    var formatInfo = this.formatInfo(format);

    // if output format is jscad , use that, otherwise use currentObjects
    var objects = format === 'jscad' ? this.script : this.currentObjects.slice(startpoint, endpoint + 1);

    return (0, _convertToBlob.convertToBlob)(objects, { format: format, formatInfo: formatInfo });
  },

  supportedFormatsForCurrentObjects: function supportedFormatsForCurrentObjects() {
    var startpoint = this.selectStartPoint;
    var endpoint = this.selectEndPoint;
    if (startpoint > endpoint) {
      startpoint = this.selectEndPoint;endpoint = this.selectStartPoint;
    }

    var objs = this.currentObjects.slice(startpoint, endpoint + 1);

    this.formatInfo('stla'); // make sure the formats are initialized

    var objectFormats = [];
    var i;
    var format;
    var foundCSG = false;
    var foundCAG = false;
    for (i = 0; i < objs.length; i++) {
      if (objs[i] instanceof _csg.CSG) {
        foundCSG = true;
      }
      if (objs[i] instanceof _csg.CAG) {
        foundCAG = true;
      }
    }
    for (format in this.formats) {
      if (foundCSG && this.formats[format].convertCSG === true) {
        objectFormats[objectFormats.length] = format;
        continue; // only add once
      }
      if (foundCAG && this.formats[format].convertCAG === true) {
        objectFormats[objectFormats.length] = format;
      }
    }
    return objectFormats;
  },

  formatInfo: function formatInfo(format) {
    return this.formats[format];
  },

  downloadLinkTextForCurrentObject: function downloadLinkTextForCurrentObject() {
    var ext = this.selectedFormatInfo().extension;
    return 'Download ' + ext.toUpperCase();
  },

  createGroupControl: function createGroupControl(definition) {
    var control = document.createElement('title');
    control.paramName = definition.name;
    control.paramType = definition.type;
    if ('caption' in definition) {
      control.text = definition.caption;
      control.className = 'caption';
    } else {
      control.text = definition.name;
    }
    return control;
  },

  createChoiceControl: function createChoiceControl(definition, prevValue) {
    if (!('values' in definition)) {
      throw new Error('Definition of choice parameter (' + definition.name + ") should include a 'values' parameter");
    }
    var control = document.createElement('select');
    control.paramName = definition.name;
    control.paramType = definition.type;
    var values = definition.values;
    var captions;
    if ('captions' in definition) {
      captions = definition.captions;
      if (captions.length != values.length) {
        throw new Error('Definition of choice parameter (' + definition.name + ") should have the same number of items for 'captions' and 'values'");
      }
    } else {
      captions = values;
    }
    var selectedindex = 0;
    for (var valueindex = 0; valueindex < values.length; valueindex++) {
      var option = document.createElement('option');
      option.value = values[valueindex];
      option.text = captions[valueindex];
      control.add(option);
      if (prevValue !== undefined) {
        if (prevValue === values[valueindex]) {
          selectedindex = valueindex;
        }
      } else if ('default' in definition) {
        if (definition['default'] === values[valueindex]) {
          selectedindex = valueindex;
        }
      } else if ('initial' in definition) {
        if (definition.initial === values[valueindex]) {
          selectedindex = valueindex;
        }
      }
    }
    if (values.length > 0) {
      control.selectedIndex = selectedindex;
    }
    return control;
  },

  createControl: function createControl(definition, prevValue) {
    var control_list = [{ type: 'text', control: 'text', required: ['index', 'type', 'name'], initial: '' }, { type: 'int', control: 'number', required: ['index', 'type', 'name'], initial: 0 }, { type: 'float', control: 'number', required: ['index', 'type', 'name'], initial: 0.0 }, { type: 'number', control: 'number', required: ['index', 'type', 'name'], initial: 0.0 }, { type: 'checkbox', control: 'checkbox', required: ['index', 'type', 'name', 'checked'], initial: '' }, { type: 'radio', control: 'radio', required: ['index', 'type', 'name', 'checked'], initial: '' }, { type: 'color', control: 'color', required: ['index', 'type', 'name'], initial: '#000000' }, { type: 'date', control: 'date', required: ['index', 'type', 'name'], initial: '' }, { type: 'email', control: 'email', required: ['index', 'type', 'name'], initial: '' }, { type: 'password', control: 'password', required: ['index', 'type', 'name'], initial: '' }, { type: 'url', control: 'url', required: ['index', 'type', 'name'], initial: '' }, { type: 'slider', control: 'range', required: ['index', 'type', 'name', 'min', 'max'], initial: 0, label: true }];
    // check for required parameters
    if (!('type' in definition)) {
      throw new Error('Parameter definition (' + definition.index + ") must include a 'type' parameter");
    }
    var control = document.createElement('input');
    var i, j, c_type, p_name;
    for (i = 0; i < control_list.length; i++) {
      c_type = control_list[i];
      if (c_type.type === definition.type) {
        for (j = 0; j < c_type.required.length; j++) {
          p_name = c_type.required[j];
          if (p_name in definition) {
            if (p_name === 'index') continue;
            if (p_name === 'type') continue;
            if (p_name === 'checked') {
              // setAttribute() only accepts strings
              control.checked = definition.checked;
            } else {
              control.setAttribute(p_name, definition[p_name]);
            }
          } else {
            throw new Error('Parameter definition (' + definition.index + ") must include a '" + p_name + "' parameter");
          }
        }
        break;
      }
    }
    if (i === control_list.length) {
      throw new Error('Parameter definition (' + definition.index + ") is not a valid 'type'");
    }
    // set the control type
    control.setAttribute('type', c_type.control);
    // set name and type for obtaining values
    control.paramName = definition.name;
    control.paramType = definition.type;
    // determine initial value of control
    if (prevValue !== undefined) {
      control.value = prevValue;
    } else if ('initial' in definition) {
      control.value = definition.initial;
    } else if ('default' in definition) {
      control.value = definition.default;
    } else {
      control.value = c_type.initial;
    }
    // set generic HTML attributes
    for (var property in definition) {
      if (definition.hasOwnProperty(property)) {
        if (c_type.required.indexOf(property) < 0) {
          control.setAttribute(property, definition[property]);
        }
      }
    }
    // add a label if necessary
    if ('label' in c_type) {
      control.label = document.createElement('label');
      control.label.innerHTML = control.value;
    }
    return control;
  },

  createParamControls: function createParamControls(prevParamValues) {
    this.parameterstable.innerHTML = '';
    this.paramControls = [];

    for (var i = 0; i < this.paramDefinitions.length; i++) {
      var paramdef = this.paramDefinitions[i];
      paramdef.index = i + 1;

      var control = null;
      var type = paramdef.type.toLowerCase();
      switch (type) {
        case 'choice':
          control = this.createChoiceControl(paramdef, prevParamValues[paramdef.name]);
          break;
        case 'group':
          control = this.createGroupControl(paramdef);
          break;
        default:
          control = this.createControl(paramdef, prevParamValues[paramdef.name]);
          break;
      }
      // add the appropriate element to the table
      var tr = document.createElement('tr');
      if (type === 'group') {
        var th = document.createElement('th');
        if ('className' in control) {
          th.className = control.className;
        }
        th.innerHTML = control.text;
        tr.appendChild(th);
      } else {
        // implementing instantUpdate
        var that = this;
        control.onchange = function (e) {
          var l = e.currentTarget.nextElementSibling;
          if (l !== null && l.nodeName === 'LABEL') {
            l.innerHTML = e.currentTarget.value;
          }
          if (document.getElementById('instantUpdate').checked === true) {
            that.rebuildSolid();
          }
        };
        this.paramControls.push(control);

        var td = document.createElement('td');
        var label = paramdef.name + ':';
        if ('caption' in paramdef) {
          label = paramdef.caption;
          td.className = 'caption';
        }
        td.innerHTML = label;
        tr.appendChild(td);
        td = document.createElement('td');
        td.appendChild(control);
        if ('label' in control) {
          td.appendChild(control.label);
        }
        tr.appendChild(td);
      }
      this.parameterstable.appendChild(tr);
    }
  }
};

},{"../io/convertToBlob":36,"../io/formats":37,"../ui/viewer/jscad-viewer":57,"./convertToSolid":38,"./generateOutputFileBlobUrl":39,"./generateOutputFileFileSystem":40,"./getParamDefinitions":41,"./getParamValues":42,"./log":46,"./rebuildSolid":48,"@jscad/csg":1,"@jscad/io":2}],48:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.rebuildSolidSync = rebuildSolidSync;
exports.rebuildSolidAsync = rebuildSolidAsync;

var _webworkify = require('webworkify');

var _webworkify2 = _interopRequireDefault(_webworkify);

var _csg = require('@jscad/csg');

var _scadApi = require('@jscad/scad-api');

var _scadApi2 = _interopRequireDefault(_scadApi);

var _jscadFunction = require('./jscad-function');

var _jscadFunction2 = _interopRequireDefault(_jscadFunction);

var _includeJscadSync = require('./includeJscadSync');

var _includeJscadSync2 = _interopRequireDefault(_includeJscadSync);

var _misc = require('../utils/misc');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * helper function that finds include() statements in files,
 * fetches their code & returns it (recursively) returning the whole code with
 * inlined includes
 * this is more reliable than async xhr + eval()
 * @param {String} text the original script (with include statements)
 * @param {String} relpath relative path, for xhr resolution
 * @param {String} memFs memFs cache object
 * @returns {String} the full script, with inlined
 */
function replaceIncludes(text, relpath, memFs) {
  return new Promise(function (resolve, reject) {
    var scriptWithIncludes = text;
    var includesPattern = /(?:include)\s?\("([\w\/.\s]*)"\);?/gm;

    var foundIncludes = [];
    var foundIncludesFull = [];
    var match = void 0;
    while (match = includesPattern.exec(text)) {
      foundIncludes.push(match[1]);
      foundIncludesFull.push(match[0]);
    }

    var tmpPromises = foundIncludes.map(function (uri, index) {
      var promise = (0, _includeJscadSync2.default)(relpath, uri, memFs);
      return promise.then(function (includedScript) {
        return replaceIncludes(includedScript, relpath, memFs).then(function (substring) {
          var currentItem = foundIncludesFull[index];
          scriptWithIncludes = scriptWithIncludes.replace(currentItem, substring);
          return scriptWithIncludes;
        });
      });
    });
    Promise.all(tmpPromises).then(function (x) {
      return resolve(scriptWithIncludes);
    });
  });
}

/**
 * evaluate script & rebuild solids, in main thread
 * @param {String} script the script
 * @param {String} fullurl full url of current script
 * @param {Object} parameters the parameters to use with the script
 * @param {Object} callback the callback to call once evaluation is done /failed
 * @param {Object} options the settings to use when rebuilding the solid
 */
function rebuildSolidSync(script, fullurl, parameters, callback, options) {
  var relpath = fullurl;
  if (relpath.lastIndexOf('/') >= 0) {
    relpath = relpath.substring(0, relpath.lastIndexOf('/') + 1);
  }
  var defaults = {
    implicitGlobals: true,
    memFs: undefined
  };
  options = Object.assign({}, defaults, options);

  replaceIncludes(script, relpath, options.memFs).then(function (fullScript) {
    var globals = options.implicitGlobals ? options.globals ? options.globals : { oscad: _scadApi2.default } : {};
    var func = (0, _jscadFunction2.default)(fullScript, globals);
    // stand-in for the include function(no-op)
    var include = function include(x) {
      return x;
    };
    try {
      var objects = func(parameters, include, globals);
      objects = (0, _misc.toArray)(objects);
      if (objects.length === 0) {
        throw new Error('The JSCAD script must return one or more CSG or CAG solids.');
      }
      callback(undefined, objects);
    } catch (error) {
      callback(error, undefined);
    }
  }).catch(function (error) {
    return callback(error, undefined);
  });

  // have we been asked to stop our work?
  return {
    cancel: function cancel() {
      console.log('cannot stop work in main thread, sorry');
    }
  };
}

/**
 * evaluate script & rebuild solids, in seperate thread/webworker
 * @param {String} script the script
 * @param {String} fullurl full url of current script
 * @param {Object} parameters the parameters to use with the script
 * @param {Object} callback the callback to call once evaluation is done /failed
 * @param {Object} options the settings to use when rebuilding the solid
 */
function rebuildSolidAsync(script, fullurl, parameters, callback, options) {
  if (!parameters) {
    throw new Error("JSCAD: missing 'parameters'");
  }
  if (!window.Worker) throw new Error('Worker threads are unsupported.');
  var defaults = {
    implicitGlobals: true,
    memFs: undefined
  };
  options = Object.assign({}, defaults, options);

  var relpath = fullurl;
  if (relpath.lastIndexOf('/') >= 0) {
    relpath = relpath.substring(0, relpath.lastIndexOf('/') + 1);
  }

  var worker = void 0;
  replaceIncludes(script, relpath, options.memFs).then(function (script) {
    worker = (0, _webworkify2.default)(require('./jscad-worker.js'));
    worker.onmessage = function (e) {
      if (e.data instanceof Object) {
        var data = e.data.objects.map(function (object) {
          if (object['class'] === 'CSG') {
            return _csg.CSG.fromCompactBinary(object);
          }
          if (object['class'] === 'CAG') {
            return _csg.CAG.fromCompactBinary(object);
          }
        });
        callback(undefined, data);
      }
    };
    worker.onerror = function (e) {
      callback('Error in line ' + e.lineno + ' : ' + e.message, undefined);
    };
    worker.postMessage({ cmd: 'render', fullurl: fullurl, script: script, parameters: parameters, options: options });
  }).catch(function (error) {
    return callback(error, undefined);
  });

  // have we been asked to stop our work?
  return {
    cancel: function cancel() {
      worker.terminate();
    }
  };
}

},{"../utils/misc":59,"./includeJscadSync":43,"./jscad-function":44,"./jscad-worker.js":45,"@jscad/csg":1,"@jscad/scad-api":3,"webworkify":34}],49:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var json = require('../../package.json');
var version = exports.version = json.version; // TODO/ add version date ?

},{"../../package.json":35}],50:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isChrome = isChrome;
exports.isSafari = isSafari;
exports.detectBrowser = detectBrowser;
function isChrome() {
  return window.navigator.userAgent.search('Chrome') >= 0;
}

function isSafari() {
  return (/Version\/[\d\.]+.*Safari/.test(window.navigator.userAgent)
  ); // FIXME WWW says don't use this
}

function detectBrowser() {
  if (navigator.userAgent.match(/(opera|chrome|safari|firefox|msie)/i)) {
    return RegExp.$1.toLowerCase();
  } else {
    return 'unknown';
  }
}

},{}],51:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = AlertUserOfUncaughtExceptions;
// Call this routine to install a handler for uncaught exceptions
function AlertUserOfUncaughtExceptions() {
  window.onerror = function (message, url, line) {
    var msg = 'uncaught exception';
    switch (arguments.length) {
      case 1:
        // message
        msg = arguments[0];
        break;
      case 2:
        // message and url
        msg = arguments[0] + '\n(' + arguments[1] + ')';
        break;
      case 3:
        // message and url and line#
        msg = arguments[0] + '\nLine: ' + arguments[2] + '\n(' + arguments[1] + ')';
        break;
      case 4: // message and url and line# and column#
      case 5:
        // message and url and line# and column# and Error
        msg = arguments[0] + '\nLine: ' + arguments[2] + ',col: ' + arguments[3] + '\n(' + arguments[1] + ')';
        break;
      default:
        break;
    }
    if ((typeof document === 'undefined' ? 'undefined' : _typeof(document)) == 'object') {
      var e = document.getElementById('errordiv');
      if (e !== null) {
        e.firstChild.textContent = msg;
        e.style.display = 'block';
      }
    } else {
      console.log(msg);
    }
    return false;
  };
}

},{}],52:[function(require,module,exports){
'use strict';

function FileSystemApiErrorHandler(fileError, operation) {
  var errormap = {
    1: 'NOT_FOUND_ERR',
    2: 'SECURITY_ERR',
    3: 'ABORT_ERR',
    4: 'NOT_READABLE_ERR',
    5: 'ENCODING_ERR',
    6: 'NO_MODIFICATION_ALLOWED_ERR',
    7: 'INVALID_STATE_ERR',
    8: 'SYNTAX_ERR',
    9: 'INVALID_MODIFICATION_ERR',
    10: 'QUOTA_EXCEEDED_ERR',
    11: 'TYPE_MISMATCH_ERR',
    12: 'PATH_EXISTS_ERR'
  };
  var errname;
  if (fileError.code in errormap) {
    errname = errormap[fileError.code];
  } else {
    errname = 'Error #' + fileError.code;
  }
  var errtxt = 'FileSystem API error: ' + operation + ' returned error ' + errname;
  throw new Error(errtxt);
}

},{}],53:[function(require,module,exports){
'use strict';

var _errorDispatcher = require('./errorDispatcher');

var _errorDispatcher2 = _interopRequireDefault(_errorDispatcher);

var _version = require('../jscad/version');

var _processor = require('../jscad/processor');

var _processor2 = _interopRequireDefault(_processor);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var gProcessor = null; // == OpenJSCAD.org, Copyright (c) 2017, Licensed under MIT License


function init() {
  var versionText = 'OpenJSCAD.org Version ' + _version.version;
  console.log(versionText);

  // Show all exceptions to the user: // WARNING !! this is not practical at dev time
  (0, _errorDispatcher2.default)();

  var viewer = document.getElementById('viewerContext');
  var design = viewer.getAttribute("design-url");

  gProcessor = new _processor2.default(viewer);

  // load the given design
  if (design) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", design, true);
    gProcessor.setStatus("Loading " + design + " <img id=busy src='imgs/busy.gif'>");

    xhr.onload = function () {
      var source = this.responseText;
      //console.log(source);

      if (design.match(/\.jscad$/i) || design.match(/\.js$/i)) {
        gProcessor.setStatus("Processing " + design + " <img id=busy src='imgs/busy.gif'>");
        gProcessor.setJsCad(source, design);
      }
    };
    xhr.send();
  }
}

document.addEventListener('DOMContentLoaded', function (event) {
  init();
});

},{"../jscad/processor":47,"../jscad/version":49,"./errorDispatcher":51}],54:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.makeAbsoluteUrl = makeAbsoluteUrl;
exports.getWindowURL = getWindowURL;
exports.textToBlobUrl = textToBlobUrl;
exports.getUrlParams = getUrlParams;
// this is a bit of a hack; doesn't properly supports urls that start with '/'
// but does handle relative urls containing ../
function makeAbsoluteUrl(url, baseurl) {
  if (!url.match(/^[a-z]+\:/i)) {
    var basecomps = baseurl.split('/');
    if (basecomps.length > 0) {
      basecomps.splice(basecomps.length - 1, 1);
    }
    var urlcomps = url.split('/');
    var comps = basecomps.concat(urlcomps);
    var comps2 = [];
    comps.map(function (c) {
      if (c == '..') {
        if (comps2.length > 0) {
          comps2.splice(comps2.length - 1, 1);
        }
      } else {
        comps2.push(c);
      }
    });
    url = '';
    for (var i = 0; i < comps2.length; i++) {
      if (i > 0) url += '/';
      url += comps2[i];
    }
  }
  return url;
}

function getWindowURL() {
  if (window.URL) return window.URL;else if (window.webkitURL) return window.webkitURL;else throw new Error("Your browser doesn't support window.URL");
}

function textToBlobUrl(txt) {
  var windowURL = getWindowURL();
  var blob = new Blob([txt], { type: 'application/javascript' });
  var blobURL = windowURL.createObjectURL(blob);
  if (!blobURL) throw new Error('createObjectURL() failed');
  return blobURL;
}

function getUrlParams(url) {
  var match = void 0;
  var params = {};
  var docTitle = void 0;
  var showEditor = void 0;
  var fetchUrl = void 0;

  var paramsCandidates = url.split('&');
  paramsCandidates.map(function (param) {
    if (match = param.match(/^.*#?param\[([^\]]+)\]=(.*)$/i)) {
      // console.log("matched parameter: key="+decodeURIComponent(match[1])+", val="+decodeURIComponent(match[2])+"")
      params[decodeURIComponent(match[1])] = decodeURIComponent(match[2]);
    } else if (match = param.match(/^.*#?showEditor=false$/i)) {
      showEditor = false;
    } else if (match = param.match(/^.*#?fetchUrl=(.*)$/i)) {
      // console.log("matched fetchUrl="+match[1])
      var urlParts = url.match(/^([^#]+)#/);
      // derive an old-style URL for compatibility's sake
      fetchUrl = urlParts[1] + '#' + decodeURIComponent(match[1]);
    } else if (match = param.match(/^.*#?title=(.*)$/i)) {
      // console.log("matched title="+decodeURIComponent(match[1]))
      docTitle = decodeURIComponent(match[1]);
    }
  });

  return {
    params: params,
    docTitle: docTitle,
    showEditor: showEditor,
    fetchUrl: fetchUrl
  };
}

},{}],55:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.colorBytes = colorBytes;
exports.colorRGBA = colorRGBA;
exports.cssFnSingleColor = cssFnSingleColor;
exports.parseColor = parseColor;
/**
 * convert color from rgba object to the array of bytes
 * @param   {object} color `{r: r, g: g, b: b, a: a}`
 * @returns {Array}  `[r, g, b, a]`
 */
function colorBytes(colorRGBA) {
  var result = [colorRGBA.r, colorRGBA.g, colorRGBA.b];
  if (colorRGBA.a !== undefined) result.push(colorRGBA.a);
  return result;
}

function colorRGBA(colorBytes) {
  var result = { r: colorBytes[0], g: colorBytes[1], b: colorBytes[2] };
  if (colorBytes[3] !== undefined) result.a = colorBytes[3];
  return result;
}

function cssFnSingleColor(str) {
  if (str[str.length - 1] === '%') {
    return parseInt(str, 10) / 100;
  } else {
    return parseInt(str, 10) / 255;
  }
}

function parseColor(color) {
  // hsl, hsv, rgba, and #xxyyzz is supported
  var rx = {
    'html3': /^#([a-f0-9]{3})$/i,
    'html6': /^#([a-f0-9]{6})$/i,
    'fn': /^(rgb|hsl|hsv)a?\s*\(([^\)]+)\)$/i
  };
  var rgba;
  var match;
  if (match = color.match(rx.html6)) {
    rgba = [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16), 1];
  } else if (match = color.match(rx.html3)) {
    rgba = [parseInt(match[1] + match[1], 16), parseInt(match[2] + match[2], 16), parseInt(match[3] + match[3], 16), 1];
  } else if (match = color.match(rx.fn)) {
    if (match[1] === 'rgb' || match[1] === 'rgba') {
      // 0-255 or percentage allowed
      var digits = match[2].split(/\s*,\s*/);
      rgba = [cssFnSingleColor(digits[0]), cssFnSingleColor(digits[1]), cssFnSingleColor(digits[2]), parseFloat(digits[3])];
    }
    // rgba = [match[1], match[2], match[3], match[4]];
    // console.log (rgba);
  }

  // console.log (match);

  return rgba;
}

},{}],56:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = LightGLEngine;

var _hammerjs = require('hammerjs');

var _hammerjs2 = _interopRequireDefault(_hammerjs);

var _lightgl = require('./lightgl');

var _lightgl2 = _interopRequireDefault(_lightgl);

var _jscadViewerHelpers = require('./jscad-viewer-helpers');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * lightgl.js renderer for jscad viewer
 * @param {DOMElement} containerelement container element
 * @param {object}     options    options for renderer
 */
function LightGLEngine(containerelement, options) {

  this.options = options;

  this.containerEl = containerelement;

  this.createRenderer();

  this.gl.resizeCanvas = this.handleResize.bind(this);

  this.animate();
};

LightGLEngine.prototype = {
  init: function init() {
    // set initial canvas size
    this.gl.canvas.width = this.containerEl.width;
    this.gl.canvas.height = this.containerEl.height;

    this.handleResize();
    // only window resize is available, so add an event callback for the canvas
    // window.addEventListener( 'resize', this.handleResize.bind (this) );
  },
  animate: function animate() {},
  handleResize: function handleResize() {
    // Set up the viewport

    var canvas = this.canvas;

    this.resizeCanvas();

    this.gl.viewport(0, 0, canvas.width, canvas.height); // pixels
    this.gl.matrixMode(this.gl.PROJECTION);
    this.gl.loadIdentity();
    this.gl.perspective(this.options.camera.fov, canvas.width / canvas.height, this.options.camera.clip.min, this.options.camera.clip.max);
    this.gl.matrixMode(this.gl.MODELVIEW);

    this.onDraw();
  },
  createRenderer: function createRenderer() {
    // Set up WebGL state
    var gl = _lightgl2.default.create();
    this.gl = gl;
    this.gl.lineWidth(1); // don't let the library choose

    this.canvas = this.gl.canvas;

    this.meshes = [];

    this.containerEl.appendChild(this.gl.canvas);

    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.clearColor.apply(this.gl, (0, _jscadViewerHelpers.colorBytes)(this.options.background.color));
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.enable(this.gl.CULL_FACE);

    var outlineColor = this.options.solid.outlineColor;

    // Black shader for wireframe
    this.blackShader = new _lightgl2.default.Shader('\
      void main() {\
        gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;\
      }', '\
      void main() {\
        gl_FragColor = vec4(' + (0, _jscadViewerHelpers.colorBytes)(outlineColor).join(', ') + ');\
      }');

    // Shader with diffuse and specular lighting
    this.lightingShader = new _lightgl2.default.Shader('\
      varying vec3 color;\
      varying float alpha;\
      varying vec3 normal;\
      varying vec3 light;\
      void main() {\
        const vec3 lightDir = vec3(1.0, 2.0, 3.0) / 3.741657386773941;\
        light = lightDir;\
        color = gl_Color.rgb;\
        alpha = gl_Color.a;\
        normal = gl_NormalMatrix * gl_Normal;\
        gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;\
      }', '\
      varying vec3 color;\
      varying float alpha;\
      varying vec3 normal;\
      varying vec3 light;\
      void main() {\
        vec3 n = normalize(normal);\
        float diffuse = max(0.0, dot(light, n));\
        float specular = pow(max(0.0, -reflect(light, n).z), 10.0) * sqrt(diffuse);\
        gl_FragColor = vec4(mix(color * (0.3 + 0.7 * diffuse), vec3(1.0), specular), alpha);\
      }');

    var _this = this;

    var shiftControl = this.createControls();

    this.resetCamera();

    this.gl.ondraw = function () {
      _this.onDraw();
    };

    // state variables, i.e. used for storing values, etc

    // state of viewer
    // 0 - initialized, no object
    // 1 - cleared, no object
    // 2 - showing, object
    this.state = 0;

    this.meshes = [];

    this.clear(); // and draw the inital viewer
  },
  createControls: function createControls() {
    var _this = this;

    var shiftControl = document.createElement('div');
    shiftControl.className = 'shift-scene';

    var leftArrow = document.createElement('div');
    leftArrow.classList.add('arrow');
    leftArrow.classList.add('arrow-left');

    var rightArrow = document.createElement('div');
    rightArrow.classList.add('arrow');
    rightArrow.classList.add('arrow-right');

    var topArrow = document.createElement('div');
    topArrow.classList.add('arrow');
    topArrow.classList.add('arrow-top');

    var bottomArrow = document.createElement('div');
    topArrow.classList.add('arrow');
    topArrow.classList.add('arrow-bottom');

    shiftControl.appendChild(leftArrow);
    shiftControl.appendChild(rightArrow);
    shiftControl.appendChild(topArrow);
    shiftControl.appendChild(bottomArrow);
    this.containerEl.appendChild(shiftControl);

    var hammerElt = new _hammerjs2.default(this.containerEl, { drag_lock_to_axis: true });
    hammerElt.on("transform", function (e) {
      if (e.gesture.touches.length >= 2) {
        _this.clearShift();
        _this.onTransform(e);
        e.preventDefault();
      }
    }).on("touch", function (e) {
      if (e.gesture.pointerType != 'touch') {
        e.preventDefault();
        return;
      }

      if (e.gesture.touches.length == 1) {
        var point = e.gesture.center;
        _this.touch.shiftTimer = setTimeout(function () {
          shiftControl.addClass('active').css({
            left: point.pageX + 'px',
            top: point.pageY + 'px'
          });
          _this.touch.shiftTimer = null;
          _this.touch.cur = 'shifting';
        }, 500);
      } else {
        _this.clearShift();
      }
    }).on("drag", function (e) {
      if (e.gesture.pointerType != 'touch') {
        e.preventDefault();
        return;
      }

      if (!_this.touch.cur || _this.touch.cur == 'dragging') {
        _this.clearShift();
        _this.onPanTilt(e);
      } else if (_this.touch.cur == 'shifting') {
        _this.onShift(e);
      }
    }).on("touchend", function (e) {
      _this.clearShift();
      if (_this.touch.cur) {
        shiftControl.removeClass('active shift-horizontal shift-vertical');
      }
    }).on("transformend dragstart dragend", function (e) {
      if (e.type == 'transformend' && _this.touch.cur == 'transforming' || e.type == 'dragend' && _this.touch.cur == 'shifting' || e.type == 'dragend' && _this.touch.cur == 'dragging') _this.touch.cur = null;
      _this.touch.lastX = 0;
      _this.touch.lastY = 0;
      _this.touch.scale = 0;
    });

    this.gl.onmousemove = function (e) {
      _this.onMouseMove(e);
    };

    this.gl.onmousewheel = function (e) {
      var wheelDelta = 0;
      if (e.wheelDelta) {
        wheelDelta = e.wheelDelta;
      } else if (e.detail) {
        // for firefox, see http://stackoverflow.com/questions/8886281/event-wheeldelta-returns-undefined
        wheelDelta = e.detail * -40;
      }
      if (wheelDelta) {
        var factor = Math.pow(1.003, -wheelDelta);
        var coeff = _this.getZoom();
        coeff *= factor;
        _this.setZoom(coeff);
      }
    };

    this.onZoomChanged = null;

    this.touch = {
      lastX: 0,
      lastY: 0,
      scale: 0,
      ctrl: 0,
      shiftTimer: null,
      shiftControl: shiftControl,
      cur: null //current state
    };

    return shiftControl;
  },
  setZoom: function setZoom(coeff) {
    //0...1
    coeff = Math.max(coeff, 0);
    coeff = Math.min(coeff, 1);
    this.viewpointZ = this.options.camera.clip.min + coeff * (this.options.camera.clip.max - this.options.camera.clip.min);
    if (this.onZoomChanged) {
      this.onZoomChanged();
    }
    this.onDraw();
  },

  getZoom: function getZoom() {
    var coeff = (this.viewpointZ - this.options.camera.clip.min) / (this.options.camera.clip.max - this.options.camera.clip.min);
    return coeff;
  },

  onMouseMove: function onMouseMove(e) {
    if (e.dragging) {
      var b = e.button;
      if (e.which) {
        // RANT: not even the mouse buttons are coherent among the brand (chrome,firefox,etc)
        b = e.which;
      }
      e.preventDefault();
      if (e.altKey || b == 3) {
        // ROTATE X,Y (ALT or right mouse button)
        this.angleY += e.deltaX;
        this.angleX += e.deltaY;
        //this.angleX = Math.max(-180, Math.min(180, this.angleX));
      } else if (e.shiftKey || b == 2) {
        // PAN  (SHIFT or middle mouse button)
        var factor = 5e-3;
        this.viewpointX += factor * e.deltaX * this.viewpointZ;
        this.viewpointY -= factor * e.deltaY * this.viewpointZ;
      } else if (e.ctrlKey || e.metaKey) {
        // ZOOM IN/OU
        var factor = Math.pow(1.006, e.deltaX + e.deltaY);
        var coeff = this.getZoom();
        coeff *= factor;
        this.setZoom(coeff);
      } else {
        // ROTATE X,Z  left mouse button
        this.angleZ += e.deltaX;
        this.angleX += e.deltaY;
      }
      this.onDraw();
    }
  },

  clearShift: function clearShift() {
    if (this.touch.shiftTimer) {
      clearTimeout(this.touch.shiftTimer);
      this.touch.shiftTimer = null;
    }
    return this;
  },

  //pan & tilt with one finger
  onPanTilt: function onPanTilt(e) {
    this.touch.cur = 'dragging';
    var delta = 0;
    if (this.touch.lastY && (e.gesture.direction == 'up' || e.gesture.direction == 'down')) {
      //tilt
      delta = e.gesture.deltaY - this.touch.lastY;
      this.angleX += delta;
    } else if (this.touch.lastX && (e.gesture.direction == 'left' || e.gesture.direction == 'right')) {
      //pan
      delta = e.gesture.deltaX - this.touch.lastX;
      this.angleZ += delta;
    }
    if (delta) this.onDraw();
    this.touch.lastX = e.gesture.deltaX;
    this.touch.lastY = e.gesture.deltaY;
  },

  //shift after 0.5s touch&hold
  onShift: function onShift(e) {
    this.touch.cur = 'shifting';
    var factor = 5e-3;
    var delta = 0;

    if (this.touch.lastY && (e.gesture.direction == 'up' || e.gesture.direction == 'down')) {
      this.touch.shiftControl.removeClass('shift-horizontal').addClass('shift-vertical').css('top', e.gesture.center.pageY + 'px');
      delta = e.gesture.deltaY - this.touch.lastY;
      this.viewpointY -= factor * delta * this.viewpointZ;
      this.angleX += delta;
    }
    if (this.touch.lastX && (e.gesture.direction == 'left' || e.gesture.direction == 'right')) {
      this.touch.shiftControl.removeClass('shift-vertical').addClass('shift-horizontal').css('left', e.gesture.center.pageX + 'px');
      delta = e.gesture.deltaX - this.touch.lastX;
      this.viewpointX += factor * delta * this.viewpointZ;
      this.angleZ += delta;
    }
    if (delta) this.onDraw();
    this.touch.lastX = e.gesture.deltaX;
    this.touch.lastY = e.gesture.deltaY;
  },

  //zooming
  onTransform: function onTransform(e) {
    this.touch.cur = 'transforming';
    if (this.touch.scale) {
      var factor = 1 / (1 + e.gesture.scale - this.touch.scale);
      var coeff = this.getZoom();
      coeff *= factor;
      this.setZoom(coeff);
    }
    this.touch.scale = e.gesture.scale;
    return this;
  },

  onDraw: function onDraw(e) {
    var gl = this.gl;
    gl.makeCurrent();

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.loadIdentity();
    // set the perspective based on the camera postion
    gl.translate(this.viewpointX, this.viewpointY, -this.viewpointZ);
    gl.rotate(this.angleX, 1, 0, 0);
    gl.rotate(this.angleY, 0, 1, 0);
    gl.rotate(this.angleZ, 0, 0, 1);
    // draw the solid (meshes)
    if (this.options.solid.draw) {
      gl.enable(gl.BLEND);
      if (!this.options.solid.overlay) gl.enable(gl.POLYGON_OFFSET_FILL);
      for (var i = 0; i < this.meshes.length; i++) {
        var mesh = this.meshes[i];
        this.lightingShader.draw(mesh, gl.TRIANGLES);
      }
      if (!this.options.solid.overlay) gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.BLEND);

      if (this.options.solid.lines) {
        if (this.options.solid.overlay) gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        for (var i = 0; i < this.meshes.length; i++) {
          var mesh = this.meshes[i];
          this.blackShader.draw(mesh, gl.LINES);
        }
        gl.disable(gl.BLEND);
        if (this.options.solid.overlay) gl.enable(gl.DEPTH_TEST);
      }
    }
    // draw the plate and the axis
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.begin(gl.LINES);

    if (this.options.plate.draw) {
      var m = this.options.plate.m; // short cut
      var M = this.options.plate.M; // short cut
      var size = this.options.plate.size / 2;
      // -- minor grid
      gl.color.apply(gl, (0, _jscadViewerHelpers.colorBytes)(m.color));
      var mg = m.i;
      var MG = M.i;
      for (var x = -size; x <= size; x += mg) {
        if (x % MG) {
          // draw only minor grid line
          gl.vertex(-size, x, 0);
          gl.vertex(size, x, 0);
          gl.vertex(x, -size, 0);
          gl.vertex(x, size, 0);
        }
      }
      // -- major grid
      gl.color.apply(gl, (0, _jscadViewerHelpers.colorBytes)(M.color));
      for (var x = -size; x <= size; x += MG) {
        gl.vertex(-size, x, 0);
        gl.vertex(size, x, 0);
        gl.vertex(x, -size, 0);
        gl.vertex(x, size, 0);
      }
    }
    if (this.options.axis.draw) {
      var size = this.options.plate.size / 2;
      // X axis
      var c = this.options.axis.x.neg;
      gl.color(c.r, c.g, c.b, c.a); //negative direction is lighter
      gl.vertex(-size, 0, 0);
      gl.vertex(0, 0, 0);
      c = this.options.axis.x.pos;
      gl.color(c.r, c.g, c.b, c.a); //positive direction is lighter
      gl.vertex(0, 0, 0);
      gl.vertex(size, 0, 0);
      // Y axis
      c = this.options.axis.y.neg;
      gl.color(c.r, c.g, c.b, c.a); //negative direction is lighter
      gl.vertex(0, -size, 0);
      gl.vertex(0, 0, 0);
      c = this.options.axis.y.pos;
      gl.color(c.r, c.g, c.b, c.a); //positive direction is lighter
      gl.vertex(0, 0, 0);
      gl.vertex(0, size, 0);
      // Z axis
      c = this.options.axis.z.neg;
      gl.color(c.r, c.g, c.b, c.a); //negative direction is lighter
      gl.vertex(0, 0, -size);
      gl.vertex(0, 0, 0);
      c = this.options.axis.z.pos;
      gl.color(c.r, c.g, c.b, c.a); //positive direction is lighter
      gl.vertex(0, 0, 0);
      gl.vertex(0, 0, size);
    }
    gl.end();
    gl.disable(gl.BLEND);
  },

  // Convert from CSG solid to an array of GL.Mesh objects
  // limiting the number of vertices per mesh to less than 2^16
  csgToMeshes: function csgToMeshes(initial_csg) {
    var csg = initial_csg.canonicalized();
    var mesh = new _lightgl2.default.Mesh({ normals: true, colors: true });
    var meshes = [mesh];
    var vertexTag2Index = {};
    var vertices = [];
    var colors = [];
    var triangles = [];
    // set to true if we want to use interpolated vertex normals
    // this creates nice round spheres but does not represent the shape of
    // the actual model
    var smoothlighting = this.options.solid.smooth;
    var polygons = csg.toPolygons();
    var numpolygons = polygons.length;
    for (var j = 0; j < numpolygons; j++) {
      var polygon = polygons[j];
      var color = (0, _jscadViewerHelpers.colorBytes)(this.options.solid.faceColor); // default color

      if (polygon.shared && polygon.shared.color) {
        color = polygon.shared.color;
      } else if (polygon.color) {
        color = polygon.color;
      }

      if (color.length < 4) color.push(1.); //opaque

      var indices = polygon.vertices.map(function (vertex) {
        var vertextag = vertex.getTag();
        var vertexindex = vertexTag2Index[vertextag];
        var prevcolor = colors[vertexindex];
        if (smoothlighting && vertextag in vertexTag2Index && prevcolor[0] == color[0] && prevcolor[1] == color[1] && prevcolor[2] == color[2]) {
          vertexindex = vertexTag2Index[vertextag];
        } else {
          vertexindex = vertices.length;
          vertexTag2Index[vertextag] = vertexindex;
          vertices.push([vertex.pos.x, vertex.pos.y, vertex.pos.z]);
          colors.push(color);
        }
        return vertexindex;
      });
      for (var i = 2; i < indices.length; i++) {
        triangles.push([indices[0], indices[i - 1], indices[i]]);
      }
      // if too many vertices, start a new mesh;
      if (vertices.length > 65000) {
        // finalize the old mesh
        mesh.triangles = triangles;
        mesh.vertices = vertices;
        mesh.colors = colors;
        mesh.computeWireframe();
        mesh.computeNormals();

        if (mesh.vertices.length) {
          meshes.push(mesh);
        }

        // start a new mesh
        mesh = new _lightgl2.default.Mesh({ normals: true, colors: true });
        triangles = [];
        colors = [];
        vertices = [];
      }
    }
    // finalize last mesh
    mesh.triangles = triangles;
    mesh.vertices = vertices;
    mesh.colors = colors;
    mesh.computeWireframe();
    mesh.computeNormals();

    if (mesh.vertices.length) {
      meshes.push(mesh);
    }

    return meshes;
  }
};

},{"./jscad-viewer-helpers":55,"./lightgl":58,"hammerjs":11}],57:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = Viewer;

var _jscadViewerLightgl = require('./jscad-viewer-lightgl');

var _jscadViewerLightgl2 = _interopRequireDefault(_jscadViewerLightgl);

var _jscadViewerHelpers = require('./jscad-viewer-helpers');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * A viewer is a WebGL canvas that lets the user view a mesh.
 * The user can tumble it around by dragging the mouse.
 * @param {DOMElement} containerelement container element
 * @param {object}     options          options for renderer
 */
function Viewer(containerelement, options) {
  // see the defaults method on how to change these
  this.options = Viewer.defaults();
  // apply all options found
  if ("camera" in options) {
    this.setCameraOptions(options["camera"]);
  }
  if ("plate" in options) {
    this.setPlateOptions(options["plate"]);
  }
  if ("axis" in options) {
    this.setAxisOptions(options["axis"]);
  }
  if ("solid" in options) {
    this.setSolidOptions(options["solid"]);
  }

  var engine;

  // select drawing engine from options
  if (this.options.engine && Viewer[this.options.engine]) {
    engine = Viewer[this.options.engine];
  }

  // instantiate the rendering engine
  if (!engine) {
    engine = _jscadViewerLightgl2.default; //|| Viewer.ThreeEngine
  }

  if (!engine) {
    throw new Error('Cannot find drawing engine, please define one via "engine" option');
  }

  // mixin methods
  for (var method in Viewer.prototype) {
    if (!(method in engine.prototype)) {
      engine.prototype[method] = Viewer.prototype[method];
    }
  }

  var e = new engine(containerelement, this.options);
  e.init();
  return e;
};

/**
 * return defaults which can be customized later
 * @returns {object} [[Description]]
 */
Viewer.defaults = function () {
  return {
    camera: {
      fov: 45, // field of view
      angle: { x: -60, y: 0, z: -45 }, // view angle about XYZ axis
      position: { x: 0, y: 0, z: 100 }, // initial position at XYZ
      clip: { min: 0.5, max: 1000 } },
    plate: {
      draw: true, // draw or not
      size: 200, // plate size (X and Y)
      // minor grid settings
      m: {
        i: 1, // number of units between minor grid lines
        color: { r: .8, g: .8, b: .8, a: .5 } },
      // major grid settings
      M: {
        i: 10, // number of units between major grid lines
        color: { r: .5, g: .5, b: .5, a: .5 } }
    },
    axis: {
      draw: false, // draw or not
      x: {
        neg: { r: 1., g: .5, b: .5, a: .5 }, // color in negative direction
        pos: { r: 1., g: 0, b: 0, a: .8 } },
      y: {
        neg: { r: .5, g: 1., b: .5, a: .5 }, // color in negative direction
        pos: { r: 0, g: 1., b: 0, a: .8 } },
      z: {
        neg: { r: .5, g: .5, b: 1., a: .5 }, // color in negative direction
        pos: { r: 0, g: 0, b: 1., a: .8 } }
    },
    solid: {
      draw: true, // draw or not
      lines: false, // draw outlines or not
      faces: true,
      overlay: false, // use overlay when drawing lines or not
      smooth: false, // use smoothing or not
      faceColor: { r: 1., g: .4, b: 1., a: 1. }, // default face color
      outlineColor: { r: .0, g: .0, b: .0, a: .1 } },
    background: {
      color: { r: .93, g: .93, b: .93, a: 1. }
    }
  };
};

Viewer.prototype = {
  parseSizeParams: function parseSizeParams() {
    // essentially, allow all relative + px. Not cm and such.
    var winResizeUnits = ['%', 'vh', 'vw', 'vmax', 'vmin'];
    var width, height;
    var containerStyle = this.containerEl.style;
    var wUnit = containerStyle.width.match(/^(\d+(?:\.\d+)?)(.*)$/)[2];
    var hUnit = typeof containerStyle.height == 'string' ? containerStyle.height.match(/^(\d+(?:\.\d+)?)(.*)$/)[2] : '';
    // whether unit scales on win resize
    var isDynUnit = containerStyle.width.match(/^calc\(/) || containerStyle.height.match(/^calc\(/) || winResizeUnits.indexOf(wUnit) != -1 || winResizeUnits.indexOf(hUnit) != -1;
    // e.g if units are %, need to keep resizing canvas with dom
    if (isDynUnit) {
      window.addEventListener('resize', this.handleResize.bind(this));
    }
  },
  resizeCanvas: function resizeCanvas() {

    var canvas = this.canvas;

    var devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = this.containerEl.clientWidth * devicePixelRatio;
    canvas.height = this.containerEl.clientHeight * devicePixelRatio;
  },
  setCsg: function setCsg(csg) {
    if (0 && csg.length) {
      // preparing multiple CSG's (not union-ed), not yet working
      for (var i = 0; i < csg.length; i++) {
        this.meshes.concat(this.csgToMeshes(csg[i]));
      }
    } else {
      this.meshes = this.csgToMeshes(csg);
    }
    this.state = 2; // showing, object
    this.onDraw();
  },

  clear: function clear() {
    // empty mesh list:
    this.meshes = [];
    this.state = 1; // cleared, no object
    this.onDraw();
  },

  resetCamera: function resetCamera() {
    // reset perpective (camera) to initial settings
    this.angleX = this.options.camera.angle.x;
    this.angleY = this.options.camera.angle.y;
    this.angleZ = this.options.camera.angle.z;
    this.viewpointX = this.options.camera.position.x;
    this.viewpointY = this.options.camera.position.y;
    this.viewpointZ = this.options.camera.position.z;
    this.onDraw();
  },

  supported: function supported() {
    return !!this.gl;
  },

  setCameraOptions: function setCameraOptions(options) {
    options = options || {};
    // apply all options found
    for (var x in this.options.camera) {
      if (x in options) {
        this.options.camera[x] = options[x];
      }
    }
  },

  setPlateOptions: function setPlateOptions(options) {
    options = options || {};
    // apply all options found
    for (var x in this.options.plate) {
      if (x in options) {
        this.options.plate[x] = options[x];
      }
    }
  },

  setAxisOptions: function setAxisOptions(options) {
    options = options || {};
    // apply all options found
    for (var x in this.options.axis) {
      if (x in options) this.options.axis[x] = options[x];
    }
  },

  setSolidOptions: function setSolidOptions(options) {
    options = options || {};
    // apply all options found
    for (var x in this.options.solid) {
      if (x in options) this.options.solid[x] = options[x];
    }
  }
};

},{"./jscad-viewer-helpers":55,"./jscad-viewer-lightgl":56}],58:[function(require,module,exports){
'use strict';

/*
 * lightgl.js
 * http://github.com/evanw/lightgl.js/
 *
 * Copyright 2011 Evan Wallace
 * Released under the MIT license
 */
var GL = function () {

	// src/texture.js
	// Provides a simple wrapper around WebGL textures that supports render-to-texture.
	// ### new GL.Texture(width, height[, options])
	//
	// The arguments `width` and `height` give the size of the texture in texels.
	// WebGL texture dimensions must be powers of two unless `filter` is set to
	// either `gl.NEAREST` or `gl.LINEAR` and `wrap` is set to `gl.CLAMP_TO_EDGE`
	// (which they are by default).
	//
	// Texture parameters can be passed in via the `options` argument.
	// Example usage:
	//
	//     var t = new GL.Texture(256, 256, {
	//       // Defaults to gl.LINEAR, set both at once with "filter"
	//       magFilter: gl.NEAREST,
	//       minFilter: gl.LINEAR,
	//
	//       // Defaults to gl.CLAMP_TO_EDGE, set both at once with "wrap"
	//       wrapS: gl.REPEAT,
	//       wrapT: gl.REPEAT,
	//
	//       format: gl.RGB, // Defaults to gl.RGBA
	//       type: gl.FLOAT // Defaults to gl.UNSIGNED_BYTE
	//     });


	function Texture(width, height, options) {
		options = options || {};
		this.id = gl.createTexture();
		this.width = width;
		this.height = height;
		this.format = options.format || gl.RGBA;
		this.type = options.type || gl.UNSIGNED_BYTE;
		gl.bindTexture(gl.TEXTURE_2D, this.id);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, options.filter || options.magFilter || gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.filter || options.minFilter || gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, options.wrap || options.wrapS || gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, options.wrap || options.wrapT || gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, this.format, width, height, 0, this.format, this.type, null);
	}

	var framebuffer;
	var renderbuffer;
	var checkerboardCanvas;

	Texture.prototype = {
		// ### .bind([unit])
		//
		// Bind this texture to the given texture unit (0-7, defaults to 0).
		bind: function bind(unit) {
			gl.activeTexture(gl.TEXTURE0 + (unit || 0));
			gl.bindTexture(gl.TEXTURE_2D, this.id);
		},

		// ### .unbind([unit])
		//
		// Clear the given texture unit (0-7, defaults to 0).
		unbind: function unbind(unit) {
			gl.activeTexture(gl.TEXTURE0 + (unit || 0));
			gl.bindTexture(gl.TEXTURE_2D, null);
		},

		// ### .drawTo(callback[, options])
		//
		// Render all draw calls in `callback` to this texture. This method
		// sets up a framebuffer with this texture as the color attachment
		// and a renderbuffer as the depth attachment.  The viewport is
		// temporarily changed to the size of the texture.
		//
		// The depth buffer can be omitted via `options` as shown in the
		// example below:
		//
		//     texture.drawTo(function() {
		//       gl.clearColor(1, 0, 0, 1);
		//       gl.clear(gl.COLOR_BUFFER_BIT);
		//     }, { depth: false });
		drawTo: function drawTo(callback, options) {

			options = options || {};
			var v = gl.getParameter(gl.VIEWPORT);
			gl.viewport(0, 0, this.width, this.height);

			framebuffer = framebuffer || gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.id, 0);

			if (options.depth !== false) {
				renderbuffer = renderbuffer || gl.createRenderbuffer();
				gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
				if (this.width != renderbuffer.width || this.height != renderbuffer.height) {
					renderbuffer.width = this.width;
					renderbuffer.height = this.height;
					gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
				}
				gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
			}

			callback();

			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.bindRenderbuffer(gl.RENDERBUFFER, null);
			gl.viewport(v[0], v[1], v[2], v[3]);
		},

		// ### .swapWith(other)
		//
		// Switch this texture with `other`, useful for the ping-pong rendering
		// technique used in multi-stage rendering.
		swapWith: function swapWith(other) {
			var temp;
			temp = other.id;
			other.id = this.id;
			this.id = temp;
			temp = other.width;
			other.width = this.width;
			this.width = temp;
			temp = other.height;
			other.height = this.height;
			this.height = temp;
		}
	};

	// ### GL.Texture.fromImage(image[, options])
	//
	// Return a new image created from `image`, an `<img>` tag.
	Texture.fromImage = function (image, options) {
		options = options || {};
		var texture = new Texture(image.width, image.height, options);
		try {
			gl.texImage2D(gl.TEXTURE_2D, 0, texture.format, texture.format, texture.type, image);
		} catch (e) {
			if (window.location.protocol == 'file:') {
				throw 'image not loaded for security reasons (serve this page over "http://" instead)';
			} else {
				throw 'image not loaded for security reasons (image must originate from the same ' + 'domain as this page or use Cross-Origin Resource Sharing)';
			}
		}
		if (options.minFilter && options.minFilter != gl.NEAREST && options.minFilter != gl.LINEAR) {
			gl.generateMipmap(gl.TEXTURE_2D);
		}
		return texture;
	};

	// ### GL.Texture.fromURL(url[, options])
	//
	// Returns a checkerboard texture that will switch to the correct texture when
	// it loads.
	Texture.fromURL = function (url, options) {
		checkerboardCanvas = checkerboardCanvas || function () {
			var c = document.createElement('canvas').getContext('2d');
			c.canvas.width = c.canvas.height = 128;
			for (var y = 0; y < c.canvas.height; y += 16) {
				for (var x = 0; x < c.canvas.width; x += 16) {
					c.fillStyle = (x ^ y) & 16 ? '#FFF' : '#DDD';
					c.fillRect(x, y, 16, 16);
				}
			}
			return c.canvas;
		}();
		var texture = Texture.fromImage(checkerboardCanvas, options);
		var image = new Image();
		var context = gl;
		image.onload = function () {
			context.makeCurrent();
			Texture.fromImage(image, options).swapWith(texture);
		};
		image.src = url;
		return texture;
	};

	// src/mesh.js
	// Represents indexed triangle geometry with arbitrary additional attributes.
	// You need a shader to draw a mesh; meshes can't draw themselves.
	//
	// A mesh is a collection of `GL.Buffer` objects which are either vertex buffers
	// (holding per-vertex attributes) or index buffers (holding the order in which
	// vertices are rendered). By default, a mesh has a position vertex buffer called
	// `vertices` and a triangle index buffer called `triangles`. New buffers can be
	// added using `addVertexBuffer()` and `addIndexBuffer()`. Two strings are
	// required when adding a new vertex buffer, the name of the data array on the
	// mesh instance and the name of the GLSL attribute in the vertex shader.
	//
	// Example usage:
	//
	//     var mesh = new GL.Mesh({ coords: true, lines: true });
	//
	//     // Default attribute "vertices", available as "gl_Vertex" in
	//     // the vertex shader
	//     mesh.vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]];
	//
	//     // Optional attribute "coords" enabled in constructor,
	//     // available as "gl_TexCoord" in the vertex shader
	//     mesh.coords = [[0, 0], [1, 0], [0, 1], [1, 1]];
	//
	//     // Custom attribute "weights", available as "weight" in the
	//     // vertex shader
	//     mesh.addVertexBuffer('weights', 'weight');
	//     mesh.weights = [1, 0, 0, 1];
	//
	//     // Default index buffer "triangles"
	//     mesh.triangles = [[0, 1, 2], [2, 1, 3]];
	//
	//     // Optional index buffer "lines" enabled in constructor
	//     mesh.lines = [[0, 1], [0, 2], [1, 3], [2, 3]];
	//
	//     // Upload provided data to GPU memory
	//     mesh.compile();
	// ### new GL.Indexer()
	//
	// Generates indices into a list of unique objects from a stream of objects
	// that may contain duplicates. This is useful for generating compact indexed
	// meshes from unindexed data.


	function Indexer() {
		this.unique = [];
		this.indices = [];
		this.map = {};
	}

	Indexer.prototype = {
		// ### .add(v)
		//
		// Adds the object `obj` to `unique` if it hasn't already been added. Returns
		// the index of `obj` in `unique`.
		add: function add(obj) {
			var key = JSON.stringify(obj);
			if (!(key in this.map)) {
				this.map[key] = this.unique.length;
				this.unique.push(obj);
			}
			return this.map[key];
		}
	};

	// ### new GL.Buffer(target, type)
	//
	// Provides a simple method of uploading data to a GPU buffer. Example usage:
	//
	//     var vertices = new GL.Buffer(gl.ARRAY_BUFFER, Float32Array);
	//     var indices = new GL.Buffer(gl.ELEMENT_ARRAY_BUFFER, Uint16Array);
	//     vertices.data = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]];
	//     indices.data = [[0, 1, 2], [2, 1, 3]];
	//     vertices.compile();
	//     indices.compile();
	//


	function Buffer(target, type) {
		this.buffer = null;
		this.target = target;
		this.type = type;
		this.data = [];
	}

	Buffer.prototype = {
		// ### .compile(type)
		//
		// Upload the contents of `data` to the GPU in preparation for rendering. The
		// data must be a list of lists where each inner list has the same length. For
		// example, each element of data for vertex normals would be a list of length three.
		// This will remember the data length and element length for later use by shaders.
		// The type can be either `gl.STATIC_DRAW` or `gl.DYNAMIC_DRAW`, and defaults to
		// `gl.STATIC_DRAW`.
		//
		// This could have used `[].concat.apply([], this.data)` to flatten
		// the array but Google Chrome has a maximum number of arguments so the
		// concatenations are chunked to avoid that limit.
		compile: function compile(type) {
			var data = [];
			for (var i = 0, chunk = 10000; i < this.data.length; i += chunk) {
				data = Array.prototype.concat.apply(data, this.data.slice(i, i + chunk));
			}
			var spacing = this.data.length ? data.length / this.data.length : 0;
			if (spacing != Math.round(spacing)) throw 'buffer elements not of consistent size, average size is ' + spacing;
			this.buffer = this.buffer || gl.createBuffer();
			this.buffer.length = data.length;
			this.buffer.spacing = spacing;
			gl.bindBuffer(this.target, this.buffer);
			gl.bufferData(this.target, new this.type(data), type || gl.STATIC_DRAW);
		}
	};

	// ### new GL.Mesh([options])
	//
	// Represents a collection of vertex buffers and index buffers. Each vertex
	// buffer maps to one attribute in GLSL and has a corresponding property set
	// on the Mesh instance. There is one vertex buffer by default: `vertices`,
	// which maps to `gl_Vertex`. The `coords`, `normals`, and `colors` vertex
	// buffers map to `gl_TexCoord`, `gl_Normal`, and `gl_Color` respectively,
	// and can be enabled by setting the corresponding options to true. There are
	// two index buffers, `triangles` and `lines`, which are used for rendering
	// `gl.TRIANGLES` and `gl.LINES`, respectively. Only `triangles` is enabled by
	// default, although `computeWireframe()` will add a normal buffer if it wasn't
	// initially enabled.


	function Mesh(options) {
		options = options || {};
		this.vertexBuffers = {};
		this.indexBuffers = {};
		this.addVertexBuffer('vertices', 'gl_Vertex');
		if (options.coords) this.addVertexBuffer('coords', 'gl_TexCoord');
		if (options.normals) this.addVertexBuffer('normals', 'gl_Normal');
		if (options.colors) this.addVertexBuffer('colors', 'gl_Color');
		if (!('triangles' in options) || options.triangles) this.addIndexBuffer('triangles');
		if (options.lines) this.addIndexBuffer('lines');
	}

	Mesh.prototype = {
		// ### .addVertexBuffer(name, attribute)
		//
		// Add a new vertex buffer with a list as a property called `name` on this object
		// and map it to the attribute called `attribute` in all shaders that draw this mesh.
		addVertexBuffer: function addVertexBuffer(name, attribute) {
			var buffer = this.vertexBuffers[attribute] = new Buffer(gl.ARRAY_BUFFER, Float32Array);
			buffer.name = name;
			this[name] = [];
		},

		// ### .addIndexBuffer(name)
		//
		// Add a new index buffer with a list as a property called `name` on this object.
		addIndexBuffer: function addIndexBuffer(name) {
			this.indexBuffers[name] = new Buffer(gl.ELEMENT_ARRAY_BUFFER, Uint16Array);
			this[name] = [];
		},

		// ### .compile()
		//
		// Upload all attached buffers to the GPU in preparation for rendering. This
		// doesn't need to be called every frame, only needs to be done when the data
		// changes.
		compile: function compile() {
			for (var attribute in this.vertexBuffers) {
				var buffer = this.vertexBuffers[attribute];
				buffer.data = this[buffer.name];
				buffer.compile();
			}

			for (var name in this.indexBuffers) {
				var buffer = this.indexBuffers[name];
				buffer.data = this[name];
				buffer.compile();
			}
		},

		// ### .transform(matrix)
		//
		// Transform all vertices by `matrix` and all normals by the inverse transpose
		// of `matrix`.
		transform: function transform(matrix) {
			this.vertices = this.vertices.map(function (v) {
				return matrix.transformPoint(Vector.fromArray(v)).toArray();
			});
			if (this.normals) {
				var invTrans = matrix.inverse().transpose();
				this.normals = this.normals.map(function (n) {
					return invTrans.transformVector(Vector.fromArray(n)).unit().toArray();
				});
			}
			this.compile();
			return this;
		},

		// ### .computeNormals()
		//
		// Computes a new normal for each vertex from the average normal of the
		// neighboring triangles. This means adjacent triangles must share vertices
		// for the resulting normals to be smooth.
		computeNormals: function computeNormals() {
			if (!this.normals) this.addVertexBuffer('normals', 'gl_Normal');
			for (var i = 0; i < this.vertices.length; i++) {
				this.normals[i] = new Vector();
			}
			for (var i = 0; i < this.triangles.length; i++) {
				var t = this.triangles[i];
				var a = Vector.fromArray(this.vertices[t[0]]);
				var b = Vector.fromArray(this.vertices[t[1]]);
				var c = Vector.fromArray(this.vertices[t[2]]);
				var normal = b.subtract(a).cross(c.subtract(a)).unit();
				this.normals[t[0]] = this.normals[t[0]].add(normal);
				this.normals[t[1]] = this.normals[t[1]].add(normal);
				this.normals[t[2]] = this.normals[t[2]].add(normal);
			}
			for (var i = 0; i < this.vertices.length; i++) {
				this.normals[i] = this.normals[i].unit().toArray();
			}
			this.compile();
			return this;
		},

		// ### .computeWireframe()
		//
		// Populate the `lines` index buffer from the `triangles` index buffer.
		computeWireframe: function computeWireframe() {
			var indexer = new Indexer();
			for (var i = 0; i < this.triangles.length; i++) {
				var t = this.triangles[i];
				for (var j = 0; j < t.length; j++) {
					var a = t[j],
					    b = t[(j + 1) % t.length];
					indexer.add([Math.min(a, b), Math.max(a, b)]);
				}
			}
			if (!this.lines) this.addIndexBuffer('lines');
			this.lines = indexer.unique;
			this.compile();
			return this;
		},

		// ### .getAABB()
		//
		// Computes the axis-aligned bounding box, which is an object whose `min` and
		// `max` properties contain the minimum and maximum coordinates of all vertices.
		getAABB: function getAABB() {
			var aabb = {
				min: new Vector(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
			};
			aabb.max = aabb.min.negative();
			for (var i = 0; i < this.vertices.length; i++) {
				var v = Vector.fromArray(this.vertices[i]);
				aabb.min = Vector.min(aabb.min, v);
				aabb.max = Vector.max(aabb.max, v);
			}
			return aabb;
		},

		// ### .getBoundingSphere()
		//
		// Computes a sphere that contains all vertices (not necessarily the smallest
		// sphere). The returned object has two properties, `center` and `radius`.
		getBoundingSphere: function getBoundingSphere() {
			var aabb = this.getAABB();
			var sphere = {
				center: aabb.min.add(aabb.max).divide(2),
				radius: 0
			};
			for (var i = 0; i < this.vertices.length; i++) {
				sphere.radius = Math.max(sphere.radius, Vector.fromArray(this.vertices[i]).subtract(sphere.center).length());
			}
			return sphere;
		}
	};

	// ### GL.Mesh.plane([options])
	//
	// Generates a square 2x2 mesh the xy plane centered at the origin. The
	// `options` argument specifies options to pass to the mesh constructor.
	// Additional options include `detailX` and `detailY`, which set the tesselation
	// in x and y, and `detail`, which sets both `detailX` and `detailY` at once.
	// Two triangles are generated by default.
	// Example usage:
	//
	//     var mesh1 = GL.Mesh.plane();
	//     var mesh2 = GL.Mesh.plane({ detail: 5 });
	//     var mesh3 = GL.Mesh.plane({ detailX: 20, detailY: 40 });
	//
	Mesh.plane = function (options) {
		options = options || {};
		var mesh = new Mesh(options),
		    detailX = options.detailX || options.detail || 1,
		    detailY = options.detailY || options.detail || 1;

		for (var y = 0; y <= detailY; y++) {
			var t = y / detailY;
			for (var x = 0; x <= detailX; x++) {
				var s = x / detailX;
				mesh.vertices.push([2 * s - 1, 2 * t - 1, 0]);
				if (mesh.coords) mesh.coords.push([s, t]);
				if (mesh.normals) mesh.normals.push([0, 0, 1]);
				if (x < detailX && y < detailY) {
					var i = x + y * (detailX + 1);
					mesh.triangles.push([i, i + 1, i + detailX + 1]);
					mesh.triangles.push([i + detailX + 1, i + 1, i + detailX + 2]);
				}
			}
		}

		mesh.compile();
		return mesh;
	};

	var cubeData = [[0, 4, 2, 6, -1, 0, 0], // -x
	[1, 3, 5, 7, +1, 0, 0], // +x
	[0, 1, 4, 5, 0, -1, 0], // -y
	[2, 6, 3, 7, 0, +1, 0], // +y
	[0, 2, 1, 3, 0, 0, -1], // -z
	[4, 5, 6, 7, 0, 0, +1] // +z
	];

	function pickOctant(i) {
		return new Vector((i & 1) * 2 - 1, (i & 2) - 1, (i & 4) / 2 - 1);
	}

	// ### GL.Mesh.cube([options])
	//
	// Generates a 2x2x2 box centered at the origin. The `options` argument
	// specifies options to pass to the mesh constructor.
	Mesh.cube = function (options) {
		var mesh = new Mesh(options);

		for (var i = 0; i < cubeData.length; i++) {
			var data = cubeData[i],
			    v = i * 4;
			for (var j = 0; j < 4; j++) {
				var d = data[j];
				mesh.vertices.push(pickOctant(d).toArray());
				if (mesh.coords) mesh.coords.push([j & 1, (j & 2) / 2]);
				if (mesh.normals) mesh.normals.push(data.slice(4, 7));
			}
			mesh.triangles.push([v, v + 1, v + 2]);
			mesh.triangles.push([v + 2, v + 1, v + 3]);
		}

		mesh.compile();
		return mesh;
	};

	// ### GL.Mesh.sphere([options])
	//
	// Generates a geodesic sphere of radius 1. The `options` argument specifies
	// options to pass to the mesh constructor in addition to the `detail` option,
	// which controls the tesselation level. The detail is `6` by default.
	// Example usage:
	//
	//     var mesh1 = GL.Mesh.sphere();
	//     var mesh2 = GL.Mesh.sphere({ detail: 2 });
	//
	Mesh.sphere = function (options) {
		function tri(a, b, c) {
			return flip ? [a, c, b] : [a, b, c];
		}

		function fix(x) {
			return x + (x - x * x) / 2;
		}
		options = options || {};
		var mesh = new Mesh(options);
		var indexer = new Indexer(),
		    detail = options.detail || 6;

		for (var octant = 0; octant < 8; octant++) {
			var scale = pickOctant(octant);
			var flip = scale.x * scale.y * scale.z > 0;
			var data = [];
			for (var i = 0; i <= detail; i++) {
				// Generate a row of vertices on the surface of the sphere
				// using barycentric coordinates.
				for (var j = 0; i + j <= detail; j++) {
					var a = i / detail;
					var b = j / detail;
					var c = (detail - i - j) / detail;
					var vertex = {
						vertex: new Vector(fix(a), fix(b), fix(c)).unit().multiply(scale).toArray()
					};
					if (mesh.coords) vertex.coord = scale.y > 0 ? [1 - a, c] : [c, 1 - a];
					data.push(indexer.add(vertex));
				}

				// Generate triangles from this row and the previous row.
				if (i > 0) {
					for (var j = 0; i + j <= detail; j++) {
						var a = (i - 1) * (detail + 1) + (i - 1 - (i - 1) * (i - 1)) / 2 + j;
						var b = i * (detail + 1) + (i - i * i) / 2 + j;
						mesh.triangles.push(tri(data[a], data[a + 1], data[b]));
						if (i + j < detail) {
							mesh.triangles.push(tri(data[b], data[a + 1], data[b + 1]));
						}
					}
				}
			}
		}

		// Reconstruct the geometry from the indexer.
		mesh.vertices = indexer.unique.map(function (v) {
			return v.vertex;
		});
		if (mesh.coords) mesh.coords = indexer.unique.map(function (v) {
			return v.coord;
		});
		if (mesh.normals) mesh.normals = mesh.vertices;
		mesh.compile();
		return mesh;
	};

	// ### GL.Mesh.load(json[, options])
	//
	// Creates a mesh from the JSON generated by the `convert/convert.py` script.
	// Example usage:
	//
	//     var data = {
	//       vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
	//       triangles: [[0, 1, 2]]
	//     };
	//     var mesh = GL.Mesh.load(data);
	//
	Mesh.load = function (json, options) {
		options = options || {};
		if (!('coords' in options)) options.coords = !!json.coords;
		if (!('normals' in options)) options.normals = !!json.normals;
		if (!('colors' in options)) options.colors = !!json.colors;
		if (!('triangles' in options)) options.triangles = !!json.triangles;
		if (!('lines' in options)) options.lines = !!json.lines;
		var mesh = new Mesh(options);
		mesh.vertices = json.vertices;
		if (mesh.coords) mesh.coords = json.coords;
		if (mesh.normals) mesh.normals = json.normals;
		if (mesh.colors) mesh.colors = json.colors;
		if (mesh.triangles) mesh.triangles = json.triangles;
		if (mesh.lines) mesh.lines = json.lines;
		mesh.compile();
		return mesh;
	};

	// src/vector.js
	// Provides a simple 3D vector class. Vector operations can be done using member
	// functions, which return new vectors, or static functions, which reuse
	// existing vectors to avoid generating garbage.


	function Vector(x, y, z) {
		this.x = x || 0;
		this.y = y || 0;
		this.z = z || 0;
	}

	// ### Instance Methods
	// The methods `add()`, `subtract()`, `multiply()`, and `divide()` can all
	// take either a vector or a number as an argument.
	Vector.prototype = {
		negative: function negative() {
			return new Vector(-this.x, -this.y, -this.z);
		},
		add: function add(v) {
			if (v instanceof Vector) return new Vector(this.x + v.x, this.y + v.y, this.z + v.z);else return new Vector(this.x + v, this.y + v, this.z + v);
		},
		subtract: function subtract(v) {
			if (v instanceof Vector) return new Vector(this.x - v.x, this.y - v.y, this.z - v.z);else return new Vector(this.x - v, this.y - v, this.z - v);
		},
		multiply: function multiply(v) {
			if (v instanceof Vector) return new Vector(this.x * v.x, this.y * v.y, this.z * v.z);else return new Vector(this.x * v, this.y * v, this.z * v);
		},
		divide: function divide(v) {
			if (v instanceof Vector) return new Vector(this.x / v.x, this.y / v.y, this.z / v.z);else return new Vector(this.x / v, this.y / v, this.z / v);
		},
		equals: function equals(v) {
			return this.x == v.x && this.y == v.y && this.z == v.z;
		},
		dot: function dot(v) {
			return this.x * v.x + this.y * v.y + this.z * v.z;
		},
		cross: function cross(v) {
			return new Vector(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
		},
		length: function length() {
			return Math.sqrt(this.dot(this));
		},
		unit: function unit() {
			return this.divide(this.length());
		},
		min: function min() {
			return Math.min(Math.min(this.x, this.y), this.z);
		},
		max: function max() {
			return Math.max(Math.max(this.x, this.y), this.z);
		},
		toAngles: function toAngles() {
			return {
				theta: Math.atan2(this.z, this.x),
				phi: Math.asin(this.y / this.length())
			};
		},
		toArray: function toArray(n) {
			return [this.x, this.y, this.z].slice(0, n || 3);
		},
		clone: function clone() {
			return new Vector(this.x, this.y, this.z);
		},
		init: function init(x, y, z) {
			this.x = x;
			this.y = y;
			this.z = z;
			return this;
		}
	};

	// ### Static Methods
	// `Vector.randomDirection()` returns a vector with a length of 1 and a
	// statistically uniform direction. `Vector.lerp()` performs linear
	// interpolation between two vectors.
	Vector.negative = function (a, b) {
		b.x = -a.x;
		b.y = -a.y;
		b.z = -a.z;
		return b;
	};
	Vector.add = function (a, b, c) {
		if (b instanceof Vector) {
			c.x = a.x + b.x;
			c.y = a.y + b.y;
			c.z = a.z + b.z;
		} else {
			c.x = a.x + b;
			c.y = a.y + b;
			c.z = a.z + b;
		}
		return c;
	};
	Vector.subtract = function (a, b, c) {
		if (b instanceof Vector) {
			c.x = a.x - b.x;
			c.y = a.y - b.y;
			c.z = a.z - b.z;
		} else {
			c.x = a.x - b;
			c.y = a.y - b;
			c.z = a.z - b;
		}
		return c;
	};
	Vector.multiply = function (a, b, c) {
		if (b instanceof Vector) {
			c.x = a.x * b.x;
			c.y = a.y * b.y;
			c.z = a.z * b.z;
		} else {
			c.x = a.x * b;
			c.y = a.y * b;
			c.z = a.z * b;
		}
		return c;
	};
	Vector.divide = function (a, b, c) {
		if (b instanceof Vector) {
			c.x = a.x / b.x;
			c.y = a.y / b.y;
			c.z = a.z / b.z;
		} else {
			c.x = a.x / b;
			c.y = a.y / b;
			c.z = a.z / b;
		}
		return c;
	};
	Vector.cross = function (a, b, c) {
		c.x = a.y * b.z - a.z * b.y;
		c.y = a.z * b.x - a.x * b.z;
		c.z = a.x * b.y - a.y * b.x;
		return c;
	};
	Vector.unit = function (a, b) {
		var length = a.length();
		b.x = a.x / length;
		b.y = a.y / length;
		b.z = a.z / length;
		return b;
	};
	Vector.fromAngles = function (theta, phi) {
		return new Vector(Math.cos(theta) * Math.cos(phi), Math.sin(phi), Math.sin(theta) * Math.cos(phi));
	};
	Vector.randomDirection = function () {
		return Vector.fromAngles(Math.random() * Math.PI * 2, Math.asin(Math.random() * 2 - 1));
	};
	Vector.min = function (a, b) {
		return new Vector(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
	};
	Vector.max = function (a, b) {
		return new Vector(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
	};
	Vector.lerp = function (a, b, fraction) {
		return b.subtract(a).multiply(fraction).add(a);
	};
	Vector.fromArray = function (a) {
		return new Vector(a[0], a[1], a[2]);
	};

	// src/shader.js
	// Provides a convenient wrapper for WebGL shaders. A few uniforms and attributes,
	// prefixed with `gl_`, are automatically added to all shader sources to make
	// simple shaders easier to write.
	//
	// Example usage:
	//
	//     var shader = new GL.Shader('\
	//       void main() {\
	//         gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;\
	//       }\
	//     ', '\
	//       uniform vec4 color;\
	//       void main() {\
	//         gl_FragColor = color;\
	//       }\
	//     ');
	//
	//     shader.uniforms({
	//       color: [1, 0, 0, 1]
	//     }).draw(mesh);

	function regexMap(regex, text, callback) {
		var result;
		while ((result = regex.exec(text)) !== null) {
			callback(result);
		}
	}

	// Non-standard names beginning with `gl_` must be mangled because they will
	// otherwise cause a compiler error.
	var LIGHTGL_PREFIX = 'LIGHTGL';

	// ### new GL.Shader(vertexSource, fragmentSource)
	//
	// Compiles a shader program using the provided vertex and fragment shaders.


	function Shader(vertexSource, fragmentSource) {
		// Allow passing in the id of an HTML script tag with the source


		function followScriptTagById(id) {
			var element = document.getElementById(id);
			return element ? element.text : id;
		}
		vertexSource = followScriptTagById(vertexSource);
		fragmentSource = followScriptTagById(fragmentSource);

		// Headers are prepended to the sources to provide some automatic functionality.
		var header = '\
    uniform mat3 gl_NormalMatrix;\
    uniform mat4 gl_ModelViewMatrix;\
    uniform mat4 gl_ProjectionMatrix;\
    uniform mat4 gl_ModelViewProjectionMatrix;\
    uniform mat4 gl_ModelViewMatrixInverse;\
    uniform mat4 gl_ProjectionMatrixInverse;\
    uniform mat4 gl_ModelViewProjectionMatrixInverse;\
  ';
		var vertexHeader = header + '\
    attribute vec4 gl_Vertex;\
    attribute vec4 gl_TexCoord;\
    attribute vec3 gl_Normal;\
    attribute vec4 gl_Color;\
    vec4 ftransform() {\
      return gl_ModelViewProjectionMatrix * gl_Vertex;\
    }\
  ';
		var fragmentHeader = '\
    precision highp float;\
  ' + header;

		// Check for the use of built-in matrices that require expensive matrix
		// multiplications to compute, and record these in `usedMatrices`.
		var source = vertexSource + fragmentSource;
		var usedMatrices = {};
		regexMap(/\b(gl_[^;]*)\b;/g, header, function (groups) {
			var name = groups[1];
			if (source.indexOf(name) != -1) {
				var capitalLetters = name.replace(/[a-z_]/g, '');
				usedMatrices[capitalLetters] = LIGHTGL_PREFIX + name;
			}
		});
		if (source.indexOf('ftransform') != -1) usedMatrices.MVPM = LIGHTGL_PREFIX + 'gl_ModelViewProjectionMatrix';
		this.usedMatrices = usedMatrices;

		// The `gl_` prefix must be substituted for something else to avoid compile
		// errors, since it's a reserved prefix. This prefixes all reserved names with
		// `_`. The header is inserted after any extensions, since those must come
		// first.


		function fix(header, source) {
			var replaced = {};
			var match = /^((\s*\/\/.*\n|\s*#extension.*\n)+)\^*$/.exec(source);
			source = match ? match[1] + header + source.substr(match[1].length) : header + source;
			regexMap(/\bgl_\w+\b/g, header, function (result) {
				if (!(result in replaced)) {
					source = source.replace(new RegExp('\\b' + result + '\\b', 'g'), LIGHTGL_PREFIX + result);
					replaced[result] = true;
				}
			});
			return source;
		}
		vertexSource = fix(vertexHeader, vertexSource);
		fragmentSource = fix(fragmentHeader, fragmentSource);

		// Compile and link errors are thrown as strings.


		function compileSource(type, source) {
			var shader = gl.createShader(type);
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				throw 'compile error: ' + gl.getShaderInfoLog(shader);
			}
			return shader;
		}
		this.program = gl.createProgram();
		gl.attachShader(this.program, compileSource(gl.VERTEX_SHADER, vertexSource));
		gl.attachShader(this.program, compileSource(gl.FRAGMENT_SHADER, fragmentSource));
		gl.linkProgram(this.program);
		if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
			throw 'link error: ' + gl.getProgramInfoLog(this.program);
		}
		this.attributes = {};
		this.uniformLocations = {};

		// Sampler uniforms need to be uploaded using `gl.uniform1i()` instead of `gl.uniform1f()`.
		// To do this automatically, we detect and remember all uniform samplers in the source code.
		var isSampler = {};
		regexMap(/uniform\s+sampler(1D|2D|3D|Cube)\s+(\w+)\s*;/g, vertexSource + fragmentSource, function (groups) {
			isSampler[groups[2]] = 1;
		});
		this.isSampler = isSampler;
	}

	function isArray(obj) {
		var str = Object.prototype.toString.call(obj);
		return str == '[object Array]' || str == '[object Float32Array]';
	}

	function isNumber(obj) {
		var str = Object.prototype.toString.call(obj);
		return str == '[object Number]' || str == '[object Boolean]';
	}

	Shader.prototype = {
		// ### .uniforms(uniforms)
		//
		// Set a uniform for each property of `uniforms`. The correct `gl.uniform*()` method is
		// inferred from the value types and from the stored uniform sampler flags.
		uniforms: function uniforms(_uniforms) {
			gl.useProgram(this.program);

			for (var name in _uniforms) {
				var location = this.uniformLocations[name] || gl.getUniformLocation(this.program, name);
				if (!location) continue;
				this.uniformLocations[name] = location;
				var value = _uniforms[name];
				if (value instanceof Vector) {
					value = [value.x, value.y, value.z];
				} else if (value instanceof Matrix) {
					value = value.m;
				}
				if (isArray(value)) {
					switch (value.length) {
						case 1:
							gl.uniform1fv(location, new Float32Array(value));
							break;
						case 2:
							gl.uniform2fv(location, new Float32Array(value));
							break;
						case 3:
							gl.uniform3fv(location, new Float32Array(value));
							break;
						case 4:
							gl.uniform4fv(location, new Float32Array(value));
							break;
						// Matrices are automatically transposed, since WebGL uses column-major
						// indices instead of row-major indices.
						case 9:
							gl.uniformMatrix3fv(location, false, new Float32Array([value[0], value[3], value[6], value[1], value[4], value[7], value[2], value[5], value[8]]));
							break;
						case 16:
							gl.uniformMatrix4fv(location, false, new Float32Array([value[0], value[4], value[8], value[12], value[1], value[5], value[9], value[13], value[2], value[6], value[10], value[14], value[3], value[7], value[11], value[15]]));
							break;
						default:
							throw 'don\'t know how to load uniform "' + name + '" of length ' + value.length;
					}
				} else if (isNumber(value)) {
					(this.isSampler[name] ? gl.uniform1i : gl.uniform1f).call(gl, location, value);
				} else {
					throw 'attempted to set uniform "' + name + '" to invalid value ' + value;
				}
			}

			return this;
		},

		// ### .draw(mesh[, mode])
		//
		// Sets all uniform matrix attributes, binds all relevant buffers, and draws the
		// mesh geometry as indexed triangles or indexed lines. Set `mode` to `gl.LINES`
		// (and either add indices to `lines` or call `computeWireframe()`) to draw the
		// mesh in wireframe.
		draw: function draw(mesh, mode) {
			this.drawBuffers(mesh.vertexBuffers, mesh.indexBuffers[mode == gl.LINES ? 'lines' : 'triangles'], arguments.length < 2 ? gl.TRIANGLES : mode);
		},

		// ### .drawBuffers(vertexBuffers, indexBuffer, mode)
		//
		// Sets all uniform matrix attributes, binds all relevant buffers, and draws the
		// indexed mesh geometry. The `vertexBuffers` argument is a map from attribute
		// names to `Buffer` objects of type `gl.ARRAY_BUFFER`, `indexBuffer` is a `Buffer`
		// object of type `gl.ELEMENT_ARRAY_BUFFER`, and `mode` is a WebGL primitive mode
		// like `gl.TRIANGLES` or `gl.LINES`. This method automatically creates and caches
		// vertex attribute pointers for attributes as needed.
		drawBuffers: function drawBuffers(vertexBuffers, indexBuffer, mode) {
			// Only construct up the built-in matrices we need for this shader.
			var used = this.usedMatrices;
			var MVM = gl.modelviewMatrix;
			var PM = gl.projectionMatrix;
			var MVMI = used.MVMI || used.NM ? MVM.inverse() : null;
			var PMI = used.PMI ? PM.inverse() : null;
			var MVPM = used.MVPM || used.MVPMI ? PM.multiply(MVM) : null;
			var matrices = {};
			if (used.MVM) matrices[used.MVM] = MVM;
			if (used.MVMI) matrices[used.MVMI] = MVMI;
			if (used.PM) matrices[used.PM] = PM;
			if (used.PMI) matrices[used.PMI] = PMI;
			if (used.MVPM) matrices[used.MVPM] = MVPM;
			if (used.MVPMI) matrices[used.MVPMI] = MVPM.inverse();
			if (used.NM) {
				var m = MVMI.m;
				matrices[used.NM] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
			}
			this.uniforms(matrices);

			// Create and enable attribute pointers as necessary.
			var length = 0;
			for (var attribute in vertexBuffers) {
				var buffer = vertexBuffers[attribute];
				var location = this.attributes[attribute] || gl.getAttribLocation(this.program, attribute.replace(/^(gl_.*)$/, LIGHTGL_PREFIX + '$1'));
				if (location == -1 || !buffer.buffer) continue;
				this.attributes[attribute] = location;
				gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
				gl.enableVertexAttribArray(location);
				gl.vertexAttribPointer(location, buffer.buffer.spacing, gl.FLOAT, false, 0, 0);
				length = buffer.buffer.length / buffer.buffer.spacing;
			}

			// Disable unused attribute pointers.
			for (var attribute in this.attributes) {
				if (!(attribute in vertexBuffers)) {
					gl.disableVertexAttribArray(this.attributes[attribute]);
				}
			}

			// Draw the geometry.
			if (length && (!indexBuffer || indexBuffer.buffer)) {
				if (indexBuffer) {
					gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
					gl.drawElements(mode, indexBuffer.buffer.length, gl.UNSIGNED_SHORT, 0);
				} else {
					gl.drawArrays(mode, 0, length);
				}
			}

			return this;
		}
	};

	// ### GL.Shader.fromURL(vsURL, fsURL)
	//
	// Compiles a shader program using the provided vertex and fragment
	// shaders. The shaders are loaded synchronously from the given URLs.
	//
	Shader.fromURL = function (vsURL, fsURL) {

		var XMLHttpRequestGet = function XMLHttpRequestGet(uri) {
			var mHttpReq = new XMLHttpRequest();
			mHttpReq.open("GET", uri, false);
			mHttpReq.send(null);
			if (mHttpReq.status !== 200) {
				throw 'could not load ' + uri;
			}
			return mHttpReq.responseText;
		};

		var vsSource = XMLHttpRequestGet(vsURL);
		var fsSource = XMLHttpRequestGet(fsURL);

		return new Shader(vsSource, fsSource);
	};

	Shader.from = function (vsURLorID, fsURLorID) {
		try {
			return new Shader(vsURLorID, fsURLorID);
		} catch (e) {
			return Shader.fromURL(vsURLorID, fsURLorID);
		}
	};

	// src/main.js
	// The internal `gl` variable holds the current WebGL context.
	var gl;

	var GL = {
		// ### Initialization
		//
		// `GL.create()` creates a new WebGL context and augments it with
		// more methods. Uses the HTML canvas given in 'options' or creates
		// a new one if necessary. The alpha channel is disabled by default
		// because it usually causes unintended transparencies in the
		// canvas.
		create: function create(options) {
			options = options || {};
			var canvas = options.canvas;
			if (!canvas) {
				canvas = document.createElement('canvas');
				canvas.width = options.width || 800;
				canvas.height = options.height || 600;
			}
			if (!('alpha' in options)) options.alpha = false;
			try {
				gl = canvas.getContext('webgl', options);
			} catch (e) {}
			try {
				gl = gl || canvas.getContext('experimental-webgl', options);
			} catch (e) {}
			if (!gl) throw 'WebGL not supported';
			addMatrixStack();
			addImmediateMode();
			addEventListeners();
			addOtherMethods();
			return gl;
		},

		// `GL.keys` contains a mapping of key codes to booleans indicating whether
		// that key is currently pressed.
		keys: {},

		// Export all external classes.
		Matrix: Matrix,
		Indexer: Indexer,
		Buffer: Buffer,
		Mesh: Mesh,
		HitTest: HitTest,
		Raytracer: Raytracer,
		Shader: Shader,
		Texture: Texture,
		Vector: Vector
	};

	// ### Matrix stack
	//
	// Implement the OpenGL modelview and projection matrix stacks, along with some
	// other useful GLU matrix functions.

	function addMatrixStack() {
		gl.MODELVIEW = ENUM | 1;
		gl.PROJECTION = ENUM | 2;
		var tempMatrix = new Matrix();
		var resultMatrix = new Matrix();
		gl.modelviewMatrix = new Matrix();
		gl.projectionMatrix = new Matrix();
		var modelviewStack = [];
		var projectionStack = [];
		var matrix, stack;
		gl.matrixMode = function (mode) {
			switch (mode) {
				case gl.MODELVIEW:
					matrix = 'modelviewMatrix';
					stack = modelviewStack;
					break;
				case gl.PROJECTION:
					matrix = 'projectionMatrix';
					stack = projectionStack;
					break;
				default:
					throw 'invalid matrix mode ' + mode;
			}
		};
		gl.loadIdentity = function () {
			Matrix.identity(gl[matrix]);
		};
		gl.loadMatrix = function (m) {
			var from = m.m,
			    to = gl[matrix].m;
			for (var i = 0; i < 16; i++) {
				to[i] = from[i];
			}
		};
		gl.multMatrix = function (m) {
			gl.loadMatrix(Matrix.multiply(gl[matrix], m, resultMatrix));
		};
		gl.perspective = function (fov, aspect, near, far) {
			gl.multMatrix(Matrix.perspective(fov, aspect, near, far, tempMatrix));
		};
		gl.frustum = function (l, r, b, t, n, f) {
			gl.multMatrix(Matrix.frustum(l, r, b, t, n, f, tempMatrix));
		};
		gl.ortho = function (l, r, b, t, n, f) {
			gl.multMatrix(Matrix.ortho(l, r, b, t, n, f, tempMatrix));
		};
		gl.scale = function (x, y, z) {
			gl.multMatrix(Matrix.scale(x, y, z, tempMatrix));
		};
		gl.translate = function (x, y, z) {
			gl.multMatrix(Matrix.translate(x, y, z, tempMatrix));
		};
		gl.rotate = function (a, x, y, z) {
			gl.multMatrix(Matrix.rotate(a, x, y, z, tempMatrix));
		};
		gl.lookAt = function (ex, ey, ez, cx, cy, cz, ux, uy, uz) {
			gl.multMatrix(Matrix.lookAt(ex, ey, ez, cx, cy, cz, ux, uy, uz, tempMatrix));
		};
		gl.pushMatrix = function () {
			stack.push(Array.prototype.slice.call(gl[matrix].m));
		};
		gl.popMatrix = function () {
			var m = stack.pop();
			gl[matrix].m = hasFloat32Array ? new Float32Array(m) : m;
		};
		gl.project = function (objX, objY, objZ, modelview, projection, viewport) {
			modelview = modelview || gl.modelviewMatrix;
			projection = projection || gl.projectionMatrix;
			viewport = viewport || gl.getParameter(gl.VIEWPORT);
			var point = projection.transformPoint(modelview.transformPoint(new Vector(objX, objY, objZ)));
			return new Vector(viewport[0] + viewport[2] * (point.x * 0.5 + 0.5), viewport[1] + viewport[3] * (point.y * 0.5 + 0.5), point.z * 0.5 + 0.5);
		};
		gl.unProject = function (winX, winY, winZ, modelview, projection, viewport) {
			modelview = modelview || gl.modelviewMatrix;
			projection = projection || gl.projectionMatrix;
			viewport = viewport || gl.getParameter(gl.VIEWPORT);
			var point = new Vector((winX - viewport[0]) / viewport[2] * 2 - 1, (winY - viewport[1]) / viewport[3] * 2 - 1, winZ * 2 - 1);
			return Matrix.inverse(Matrix.multiply(projection, modelview, tempMatrix), resultMatrix).transformPoint(point);
		};
		gl.matrixMode(gl.MODELVIEW);
	}

	// ### Immediate mode
	//
	// Provide an implementation of OpenGL's deprecated immediate mode. This is
	// depricated for a reason: constantly re-specifying the geometry is a bad
	// idea for performance. You should use a `GL.Mesh` instead, which specifies
	// the geometry once and caches it on the graphics card. Still, nothing
	// beats a quick `gl.begin(gl.POINTS); gl.vertex(1, 2, 3); gl.end();` for
	// debugging. This intentionally doesn't implement fixed-function lighting
	// because it's only meant for quick debugging tasks.

	function addImmediateMode() {
		var immediateMode = {
			mesh: new Mesh({
				coords: true,
				colors: true,
				triangles: false
			}),
			mode: -1,
			coord: [0, 0, 0, 0],
			color: [1, 1, 1, 1],
			pointSize: 1,
			shader: new Shader('\
      uniform float pointSize;\
      varying vec4 color;\
      varying vec4 coord;\
      void main() {\
        color = gl_Color;\
        coord = gl_TexCoord;\
        gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;\
        gl_PointSize = pointSize;\
      }\
    ', '\
      uniform sampler2D texture;\
      uniform float pointSize;\
      uniform bool useTexture;\
      varying vec4 color;\
      varying vec4 coord;\
      void main() {\
        gl_FragColor = color;\
        if (useTexture) gl_FragColor *= texture2D(texture, coord.xy);\
      }\
    ')
		};
		gl.pointSize = function (pointSize) {
			immediateMode.shader.uniforms({
				pointSize: pointSize
			});
		};
		gl.begin = function (mode) {
			if (immediateMode.mode != -1) throw 'mismatched gl.begin() and gl.end() calls';
			immediateMode.mode = mode;
			immediateMode.mesh.colors = [];
			immediateMode.mesh.coords = [];
			immediateMode.mesh.vertices = [];
		};
		gl.color = function (r, g, b, a) {
			immediateMode.color = arguments.length == 1 ? r.toArray().concat(1) : [r, g, b, a || 1];
		};
		gl.texCoord = function (s, t) {
			immediateMode.coord = arguments.length == 1 ? s.toArray(2) : [s, t];
		};
		gl.vertex = function (x, y, z) {
			immediateMode.mesh.colors.push(immediateMode.color);
			immediateMode.mesh.coords.push(immediateMode.coord);
			immediateMode.mesh.vertices.push(arguments.length == 1 ? x.toArray() : [x, y, z]);
		};
		gl.end = function () {
			if (immediateMode.mode == -1) throw 'mismatched gl.begin() and gl.end() calls';
			immediateMode.mesh.compile();
			immediateMode.shader.uniforms({
				useTexture: !!gl.getParameter(gl.TEXTURE_BINDING_2D)
			}).draw(immediateMode.mesh, immediateMode.mode);
			immediateMode.mode = -1;
		};
	}

	// ### Improved mouse events
	//
	// This adds event listeners on the `gl.canvas` element that call
	// `gl.onmousedown()`, `gl.onmousemove()`, and `gl.onmouseup()` with an
	// augmented event object. The event object also has the properties `x`, `y`,
	// `deltaX`, `deltaY`, and `dragging`.


	function addEventListeners() {

		var context = gl,
		    oldX = 0,
		    oldY = 0,
		    buttons = {},
		    hasOld = false;
		var has = Object.prototype.hasOwnProperty;

		function isDragging() {
			for (var b in buttons) {
				if (has.call(buttons, b) && buttons[b]) return true;
			}
			return false;
		}

		function augment(original) {
			// Make a copy of original, a native `MouseEvent`, so we can overwrite
			// WebKit's non-standard read-only `x` and `y` properties (which are just
			// duplicates of `pageX` and `pageY`). We can't just use
			// `Object.create(original)` because some `MouseEvent` functions must be
			// called in the context of the original event object.
			var e = {};
			for (var name in original) {
				if (typeof original[name] == 'function') {
					e[name] = function (callback) {
						return function () {
							callback.apply(original, arguments);
						};
					}(original[name]);
				} else {
					e[name] = original[name];
				}
			}
			e.original = original;
			e.x = e.pageX;
			e.y = e.pageY;
			for (var obj = gl.canvas; obj; obj = obj.offsetParent) {
				e.x -= obj.offsetLeft;
				e.y -= obj.offsetTop;
			}
			if (hasOld) {
				e.deltaX = e.x - oldX;
				e.deltaY = e.y - oldY;
			} else {
				e.deltaX = 0;
				e.deltaY = 0;
				hasOld = true;
			}
			oldX = e.x;
			oldY = e.y;
			e.dragging = isDragging();
			e.preventDefault = function () {
				e.original.preventDefault();
			};
			e.stopPropagation = function () {
				e.original.stopPropagation();
			};
			return e;
		}

		function augmentTouchEvent(original) {
			var e = {};
			for (var name in original) {
				if (typeof original[name] == 'function') {
					e[name] = function (callback) {
						return function () {
							callback.apply(original, arguments);
						};
					}(original[name]);
				} else {
					e[name] = original[name];
				}
			}
			e.original = original;

			if (e.targetTouches.length > 0) {
				var touch = e.targetTouches[0];
				e.x = touch.pageX;
				e.y = touch.pageY;

				for (var obj = gl.canvas; obj; obj = obj.offsetParent) {
					e.x -= obj.offsetLeft;
					e.y -= obj.offsetTop;
				}
				if (hasOld) {
					e.deltaX = e.x - oldX;
					e.deltaY = e.y - oldY;
				} else {
					e.deltaX = 0;
					e.deltaY = 0;
					hasOld = true;
				}
				oldX = e.x;
				oldY = e.y;
				e.dragging = true;
			}

			e.preventDefault = function () {
				e.original.preventDefault();
			};
			e.stopPropagation = function () {
				e.original.stopPropagation();
			};
			return e;
		}

		function mousedown(e) {
			gl = context;
			if (!isDragging()) {
				// Expand the event handlers to the document to handle dragging off canvas.
				on(document, 'mousemove', mousemove);
				on(document, 'mouseup', mouseup);
				off(gl.canvas, 'mousemove', mousemove);
				off(gl.canvas, 'mouseup', mouseup);
			}
			buttons[e.which] = true;
			e = augment(e);
			if (gl.onmousedown) gl.onmousedown(e);
			e.preventDefault();
		}

		function mousemove(e) {
			gl = context;
			e = augment(e);
			if (gl.onmousemove) gl.onmousemove(e);
			e.preventDefault();
		}

		function mouseup(e) {
			gl = context;
			buttons[e.which] = false;
			if (!isDragging()) {
				// Shrink the event handlers back to the canvas when dragging ends.
				off(document, 'mousemove', mousemove);
				off(document, 'mouseup', mouseup);
				on(gl.canvas, 'mousemove', mousemove);
				on(gl.canvas, 'mouseup', mouseup);
			}
			e = augment(e);
			if (gl.onmouseup) gl.onmouseup(e);
			e.preventDefault();
		}

		function mousewheel(e) {
			gl = context;
			e = augment(e);
			if (gl.onmousewheel) gl.onmousewheel(e);
			e.preventDefault();
		}

		function touchstart(e) {
			resetAll();
			// Expand the event handlers to the document to handle dragging off canvas.
			on(document, 'touchmove', touchmove);
			on(document, 'touchend', touchend);
			off(gl.canvas, 'touchmove', touchmove);
			off(gl.canvas, 'touchend', touchend);
			gl = context;
			e = augmentTouchEvent(e);
			if (gl.ontouchstart) gl.ontouchstart(e);
			e.preventDefault();
		}

		function touchmove(e) {
			gl = context;
			if (e.targetTouches.length === 0) {
				touchend(e);
			}
			e = augmentTouchEvent(e);
			if (gl.ontouchmove) gl.ontouchmove(e);
			e.preventDefault();
		}

		function touchend(e) {
			// Shrink the event handlers back to the canvas when dragging ends.
			off(document, 'touchmove', touchmove);
			off(document, 'touchend', touchend);
			on(gl.canvas, 'touchmove', touchmove);
			on(gl.canvas, 'touchend', touchend);
			gl = context;
			e = augmentTouchEvent(e);
			if (gl.ontouchend) gl.ontouchend(e);
			e.preventDefault();
		}

		function reset() {
			hasOld = false;
		}

		function resetAll() {
			buttons = {};
			hasOld = false;
		}

		// We can keep mouse and touch events enabled at the same time,
		// because Google Chrome will apparently never fire both of them.
		on(gl.canvas, 'mousedown', mousedown);
		on(gl.canvas, 'mousemove', mousemove);
		on(gl.canvas, 'mouseup', mouseup);
		on(gl.canvas, 'mousewheel', mousewheel);
		on(gl.canvas, 'DOMMouseScroll', mousewheel);
		on(gl.canvas, 'mouseover', reset);
		on(gl.canvas, 'mouseout', reset);
		on(gl.canvas, 'touchstart', touchstart);
		on(gl.canvas, 'touchmove', touchmove);
		on(gl.canvas, 'touchend', touchend);
		on(document, 'contextmenu', resetAll);
	}

	// ### Automatic keyboard state
	//
	// The current keyboard state is stored in `GL.keys`, a map of integer key
	// codes to booleans indicating whether that key is currently pressed. Certain
	// keys also have named identifiers that can be used directly, such as
	// `GL.keys.SPACE`. Values in `GL.keys` are initially undefined until that
	// key is pressed for the first time. If you need a boolean value, you can
	// cast the value to boolean by applying the not operator twice (as in
	// `!!GL.keys.SPACE`).

	function mapKeyCode(code) {
		var named = {
			8: 'BACKSPACE',
			9: 'TAB',
			13: 'ENTER',
			16: 'SHIFT',
			27: 'ESCAPE',
			32: 'SPACE',
			37: 'LEFT',
			38: 'UP',
			39: 'RIGHT',
			40: 'DOWN'
		};
		return named[code] || (code >= 65 && code <= 90 ? String.fromCharCode(code) : null);
	}

	function on(element, name, callback) {
		element.addEventListener(name, callback);
	}

	function off(element, name, callback) {
		element.removeEventListener(name, callback);
	}

	on(document, 'keydown', function (e) {
		if (!e.altKey && !e.ctrlKey && !e.metaKey) {
			var key = mapKeyCode(e.keyCode);
			if (key) GL.keys[key] = true;
			GL.keys[e.keyCode] = true;
		}
	});

	on(document, 'keyup', function (e) {
		if (!e.altKey && !e.ctrlKey && !e.metaKey) {
			var key = mapKeyCode(e.keyCode);
			if (key) GL.keys[key] = false;
			GL.keys[e.keyCode] = false;
		}
	});

	function addOtherMethods() {
		// ### Multiple contexts
		//
		// When using multiple contexts in one web page, `gl.makeCurrent()` must be
		// called before issuing commands to a different context.
		(function (context) {
			gl.makeCurrent = function () {
				gl = context;
			};
		})(gl);

		// ### Animation
		//
		// Call `gl.animate()` to provide an animation loop that repeatedly calls
		// `gl.onupdate()` and `gl.ondraw()`.
		gl.animate = function () {
			var post = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || function (callback) {
				setTimeout(callback, 1000 / 60);
			};
			var time = new Date().getTime();
			var context = gl;

			function update() {
				gl = context;
				var now = new Date().getTime();
				if (gl.onupdate) gl.onupdate((now - time) / 1000);
				if (gl.ondraw) gl.ondraw();
				post(update);
				time = now;
			}
			update();
		};

		// ### Fullscreen
		//
		// Provide an easy way to get a fullscreen app running, including an
		// automatic 3D perspective projection matrix by default. This should be
		// called once.
		//
		// Just fullscreen, no automatic camera:
		//
		//     gl.fullscreen({ camera: false });
		//
		// Adjusting field of view, near plane distance, and far plane distance:
		//
		//     gl.fullscreen({ fov: 45, near: 0.1, far: 1000 });
		//
		// Adding padding from the edge of the window:
		//
		//     gl.fullscreen({ paddingLeft: 250, paddingBottom: 60 });
		//
		gl.fullscreen = function (options) {
			options = options || {};
			var top = options.paddingTop || 0;
			var left = options.paddingLeft || 0;
			var right = options.paddingRight || 0;
			var bottom = options.paddingBottom || 0;
			if (!document.body) {
				throw 'document.body doesn\'t exist yet (call gl.fullscreen() from ' + 'window.onload() or from inside the <body> tag)';
			}
			document.body.appendChild(gl.canvas);
			document.body.style.overflow = 'hidden';
			gl.canvas.style.position = 'absolute';
			gl.canvas.style.left = left + 'px';
			gl.canvas.style.top = top + 'px';

			function resize() {
				gl.canvas.width = window.innerWidth - left - right;
				gl.canvas.height = window.innerHeight - top - bottom;
				gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
				if (options.camera || !('camera' in options)) {
					gl.matrixMode(gl.PROJECTION);
					gl.loadIdentity();
					gl.perspective(options.fov || 45, gl.canvas.width / gl.canvas.height, options.near || 0.1, options.far || 1000);
					gl.matrixMode(gl.MODELVIEW);
				}
				if (gl.onresize) gl.onresize();
				if (gl.ondraw) gl.ondraw();
			}
			on(window, 'resize', resize);
			resize();
		};
	}

	// A value to bitwise-or with new enums to make them distinguishable from the
	// standard WebGL enums.
	var ENUM = 0x12340000;

	// src/matrix.js
	// Represents a 4x4 matrix stored in row-major order that uses Float32Arrays
	// when available. Matrix operations can either be done using convenient
	// methods that return a new matrix for the result or optimized methods
	// that store the result in an existing matrix to avoid generating garbage.
	var hasFloat32Array = typeof Float32Array != 'undefined';

	// ### new GL.Matrix([elements])
	//
	// This constructor takes 16 arguments in row-major order, which can be passed
	// individually, as a list, or even as four lists, one for each row. If the
	// arguments are omitted then the identity matrix is constructed instead.


	function Matrix() {
		var m = Array.prototype.concat.apply([], arguments);
		if (!m.length) {
			m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		}
		this.m = hasFloat32Array ? new Float32Array(m) : m;
	}

	Matrix.prototype = {
		// ### .inverse()
		//
		// Returns the matrix that when multiplied with this matrix results in the
		// identity matrix.
		inverse: function inverse() {
			return Matrix.inverse(this, new Matrix());
		},

		// ### .transpose()
		//
		// Returns this matrix, exchanging columns for rows.
		transpose: function transpose() {
			return Matrix.transpose(this, new Matrix());
		},

		// ### .multiply(matrix)
		//
		// Returns the concatenation of the transforms for this matrix and `matrix`.
		// This emulates the OpenGL function `glMultMatrix()`.
		multiply: function multiply(matrix) {
			return Matrix.multiply(this, matrix, new Matrix());
		},

		// ### .transformPoint(point)
		//
		// Transforms the vector as a point with a w coordinate of 1. This
		// means translations will have an effect, for example.
		transformPoint: function transformPoint(v) {
			var m = this.m;
			return new Vector(m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3], m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7], m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11]).divide(m[12] * v.x + m[13] * v.y + m[14] * v.z + m[15]);
		},

		// ### .transformPoint(vector)
		//
		// Transforms the vector as a vector with a w coordinate of 0. This
		// means translations will have no effect, for example.
		transformVector: function transformVector(v) {
			var m = this.m;
			return new Vector(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[4] * v.x + m[5] * v.y + m[6] * v.z, m[8] * v.x + m[9] * v.y + m[10] * v.z);
		}
	};

	// ### GL.Matrix.inverse(matrix[, result])
	//
	// Returns the matrix that when multiplied with `matrix` results in the
	// identity matrix. You can optionally pass an existing matrix in `result`
	// to avoid allocating a new matrix. This implementation is from the Mesa
	// OpenGL function `__gluInvertMatrixd()` found in `project.c`.
	Matrix.inverse = function (matrix, result) {
		result = result || new Matrix();
		var m = matrix.m,
		    r = result.m;

		r[0] = m[5] * m[10] * m[15] - m[5] * m[14] * m[11] - m[6] * m[9] * m[15] + m[6] * m[13] * m[11] + m[7] * m[9] * m[14] - m[7] * m[13] * m[10];
		r[1] = -m[1] * m[10] * m[15] + m[1] * m[14] * m[11] + m[2] * m[9] * m[15] - m[2] * m[13] * m[11] - m[3] * m[9] * m[14] + m[3] * m[13] * m[10];
		r[2] = m[1] * m[6] * m[15] - m[1] * m[14] * m[7] - m[2] * m[5] * m[15] + m[2] * m[13] * m[7] + m[3] * m[5] * m[14] - m[3] * m[13] * m[6];
		r[3] = -m[1] * m[6] * m[11] + m[1] * m[10] * m[7] + m[2] * m[5] * m[11] - m[2] * m[9] * m[7] - m[3] * m[5] * m[10] + m[3] * m[9] * m[6];

		r[4] = -m[4] * m[10] * m[15] + m[4] * m[14] * m[11] + m[6] * m[8] * m[15] - m[6] * m[12] * m[11] - m[7] * m[8] * m[14] + m[7] * m[12] * m[10];
		r[5] = m[0] * m[10] * m[15] - m[0] * m[14] * m[11] - m[2] * m[8] * m[15] + m[2] * m[12] * m[11] + m[3] * m[8] * m[14] - m[3] * m[12] * m[10];
		r[6] = -m[0] * m[6] * m[15] + m[0] * m[14] * m[7] + m[2] * m[4] * m[15] - m[2] * m[12] * m[7] - m[3] * m[4] * m[14] + m[3] * m[12] * m[6];
		r[7] = m[0] * m[6] * m[11] - m[0] * m[10] * m[7] - m[2] * m[4] * m[11] + m[2] * m[8] * m[7] + m[3] * m[4] * m[10] - m[3] * m[8] * m[6];

		r[8] = m[4] * m[9] * m[15] - m[4] * m[13] * m[11] - m[5] * m[8] * m[15] + m[5] * m[12] * m[11] + m[7] * m[8] * m[13] - m[7] * m[12] * m[9];
		r[9] = -m[0] * m[9] * m[15] + m[0] * m[13] * m[11] + m[1] * m[8] * m[15] - m[1] * m[12] * m[11] - m[3] * m[8] * m[13] + m[3] * m[12] * m[9];
		r[10] = m[0] * m[5] * m[15] - m[0] * m[13] * m[7] - m[1] * m[4] * m[15] + m[1] * m[12] * m[7] + m[3] * m[4] * m[13] - m[3] * m[12] * m[5];
		r[11] = -m[0] * m[5] * m[11] + m[0] * m[9] * m[7] + m[1] * m[4] * m[11] - m[1] * m[8] * m[7] - m[3] * m[4] * m[9] + m[3] * m[8] * m[5];

		r[12] = -m[4] * m[9] * m[14] + m[4] * m[13] * m[10] + m[5] * m[8] * m[14] - m[5] * m[12] * m[10] - m[6] * m[8] * m[13] + m[6] * m[12] * m[9];
		r[13] = m[0] * m[9] * m[14] - m[0] * m[13] * m[10] - m[1] * m[8] * m[14] + m[1] * m[12] * m[10] + m[2] * m[8] * m[13] - m[2] * m[12] * m[9];
		r[14] = -m[0] * m[5] * m[14] + m[0] * m[13] * m[6] + m[1] * m[4] * m[14] - m[1] * m[12] * m[6] - m[2] * m[4] * m[13] + m[2] * m[12] * m[5];
		r[15] = m[0] * m[5] * m[10] - m[0] * m[9] * m[6] - m[1] * m[4] * m[10] + m[1] * m[8] * m[6] + m[2] * m[4] * m[9] - m[2] * m[8] * m[5];

		var det = m[0] * r[0] + m[1] * r[4] + m[2] * r[8] + m[3] * r[12];
		for (var i = 0; i < 16; i++) {
			r[i] /= det;
		}return result;
	};

	// ### GL.Matrix.transpose(matrix[, result])
	//
	// Returns `matrix`, exchanging columns for rows. You can optionally pass an
	// existing matrix in `result` to avoid allocating a new matrix.
	Matrix.transpose = function (matrix, result) {
		result = result || new Matrix();
		var m = matrix.m,
		    r = result.m;
		r[0] = m[0];
		r[1] = m[4];
		r[2] = m[8];
		r[3] = m[12];
		r[4] = m[1];
		r[5] = m[5];
		r[6] = m[9];
		r[7] = m[13];
		r[8] = m[2];
		r[9] = m[6];
		r[10] = m[10];
		r[11] = m[14];
		r[12] = m[3];
		r[13] = m[7];
		r[14] = m[11];
		r[15] = m[15];
		return result;
	};

	// ### GL.Matrix.multiply(left, right[, result])
	//
	// Returns the concatenation of the transforms for `left` and `right`. You can
	// optionally pass an existing matrix in `result` to avoid allocating a new
	// matrix. This emulates the OpenGL function `glMultMatrix()`.
	Matrix.multiply = function (left, right, result) {
		result = result || new Matrix();
		var a = left.m,
		    b = right.m,
		    r = result.m;

		r[0] = a[0] * b[0] + a[1] * b[4] + a[2] * b[8] + a[3] * b[12];
		r[1] = a[0] * b[1] + a[1] * b[5] + a[2] * b[9] + a[3] * b[13];
		r[2] = a[0] * b[2] + a[1] * b[6] + a[2] * b[10] + a[3] * b[14];
		r[3] = a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3] * b[15];

		r[4] = a[4] * b[0] + a[5] * b[4] + a[6] * b[8] + a[7] * b[12];
		r[5] = a[4] * b[1] + a[5] * b[5] + a[6] * b[9] + a[7] * b[13];
		r[6] = a[4] * b[2] + a[5] * b[6] + a[6] * b[10] + a[7] * b[14];
		r[7] = a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7] * b[15];

		r[8] = a[8] * b[0] + a[9] * b[4] + a[10] * b[8] + a[11] * b[12];
		r[9] = a[8] * b[1] + a[9] * b[5] + a[10] * b[9] + a[11] * b[13];
		r[10] = a[8] * b[2] + a[9] * b[6] + a[10] * b[10] + a[11] * b[14];
		r[11] = a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11] * b[15];

		r[12] = a[12] * b[0] + a[13] * b[4] + a[14] * b[8] + a[15] * b[12];
		r[13] = a[12] * b[1] + a[13] * b[5] + a[14] * b[9] + a[15] * b[13];
		r[14] = a[12] * b[2] + a[13] * b[6] + a[14] * b[10] + a[15] * b[14];
		r[15] = a[12] * b[3] + a[13] * b[7] + a[14] * b[11] + a[15] * b[15];

		return result;
	};

	// ### GL.Matrix.identity([result])
	//
	// Returns an identity matrix. You can optionally pass an existing matrix in
	// `result` to avoid allocating a new matrix. This emulates the OpenGL function
	// `glLoadIdentity()`.
	Matrix.identity = function (result) {
		result = result || new Matrix();
		var m = result.m;
		m[0] = m[5] = m[10] = m[15] = 1;
		m[1] = m[2] = m[3] = m[4] = m[6] = m[7] = m[8] = m[9] = m[11] = m[12] = m[13] = m[14] = 0;
		return result;
	};

	// ### GL.Matrix.perspective(fov, aspect, near, far[, result])
	//
	// Returns a perspective transform matrix, which makes far away objects appear
	// smaller than nearby objects. The `aspect` argument should be the width
	// divided by the height of your viewport and `fov` is the top-to-bottom angle
	// of the field of view in degrees. You can optionally pass an existing matrix
	// in `result` to avoid allocating a new matrix. This emulates the OpenGL
	// function `gluPerspective()`.
	Matrix.perspective = function (fov, aspect, near, far, result) {
		var y = Math.tan(fov * Math.PI / 360) * near;
		var x = y * aspect;
		return Matrix.frustum(-x, x, -y, y, near, far, result);
	};

	// ### GL.Matrix.frustum(left, right, bottom, top, near, far[, result])
	//
	// Sets up a viewing frustum, which is shaped like a truncated pyramid with the
	// camera where the point of the pyramid would be. You can optionally pass an
	// existing matrix in `result` to avoid allocating a new matrix. This emulates
	// the OpenGL function `glFrustum()`.
	Matrix.frustum = function (l, r, b, t, n, f, result) {
		result = result || new Matrix();
		var m = result.m;

		m[0] = 2 * n / (r - l);
		m[1] = 0;
		m[2] = (r + l) / (r - l);
		m[3] = 0;

		m[4] = 0;
		m[5] = 2 * n / (t - b);
		m[6] = (t + b) / (t - b);
		m[7] = 0;

		m[8] = 0;
		m[9] = 0;
		m[10] = -(f + n) / (f - n);
		m[11] = -2 * f * n / (f - n);

		m[12] = 0;
		m[13] = 0;
		m[14] = -1;
		m[15] = 0;

		return result;
	};

	// ### GL.Matrix.ortho(left, right, bottom, top, near, far[, result])
	//
	// Returns an orthographic projection, in which objects are the same size no
	// matter how far away or nearby they are. You can optionally pass an existing
	// matrix in `result` to avoid allocating a new matrix. This emulates the OpenGL
	// function `glOrtho()`.
	Matrix.ortho = function (l, r, b, t, n, f, result) {
		result = result || new Matrix();
		var m = result.m;

		m[0] = 2 / (r - l);
		m[1] = 0;
		m[2] = 0;
		m[3] = -(r + l) / (r - l);

		m[4] = 0;
		m[5] = 2 / (t - b);
		m[6] = 0;
		m[7] = -(t + b) / (t - b);

		m[8] = 0;
		m[9] = 0;
		m[10] = -2 / (f - n);
		m[11] = -(f + n) / (f - n);

		m[12] = 0;
		m[13] = 0;
		m[14] = 0;
		m[15] = 1;

		return result;
	};

	// ### GL.Matrix.scale(x, y, z[, result])
	//
	// This emulates the OpenGL function `glScale()`. You can optionally pass an
	// existing matrix in `result` to avoid allocating a new matrix.
	Matrix.scale = function (x, y, z, result) {
		result = result || new Matrix();
		var m = result.m;

		m[0] = x;
		m[1] = 0;
		m[2] = 0;
		m[3] = 0;

		m[4] = 0;
		m[5] = y;
		m[6] = 0;
		m[7] = 0;

		m[8] = 0;
		m[9] = 0;
		m[10] = z;
		m[11] = 0;

		m[12] = 0;
		m[13] = 0;
		m[14] = 0;
		m[15] = 1;

		return result;
	};

	// ### GL.Matrix.translate(x, y, z[, result])
	//
	// This emulates the OpenGL function `glTranslate()`. You can optionally pass
	// an existing matrix in `result` to avoid allocating a new matrix.
	Matrix.translate = function (x, y, z, result) {
		result = result || new Matrix();
		var m = result.m;

		m[0] = 1;
		m[1] = 0;
		m[2] = 0;
		m[3] = x;

		m[4] = 0;
		m[5] = 1;
		m[6] = 0;
		m[7] = y;

		m[8] = 0;
		m[9] = 0;
		m[10] = 1;
		m[11] = z;

		m[12] = 0;
		m[13] = 0;
		m[14] = 0;
		m[15] = 1;

		return result;
	};

	// ### GL.Matrix.rotate(a, x, y, z[, result])
	//
	// Returns a matrix that rotates by `a` degrees around the vector `x, y, z`.
	// You can optionally pass an existing matrix in `result` to avoid allocating
	// a new matrix. This emulates the OpenGL function `glRotate()`.
	Matrix.rotate = function (a, x, y, z, result) {
		if (!a || !x && !y && !z) {
			return Matrix.identity(result);
		}

		result = result || new Matrix();
		var m = result.m;

		var d = Math.sqrt(x * x + y * y + z * z);
		a *= Math.PI / 180;
		x /= d;
		y /= d;
		z /= d;
		var c = Math.cos(a),
		    s = Math.sin(a),
		    t = 1 - c;

		m[0] = x * x * t + c;
		m[1] = x * y * t - z * s;
		m[2] = x * z * t + y * s;
		m[3] = 0;

		m[4] = y * x * t + z * s;
		m[5] = y * y * t + c;
		m[6] = y * z * t - x * s;
		m[7] = 0;

		m[8] = z * x * t - y * s;
		m[9] = z * y * t + x * s;
		m[10] = z * z * t + c;
		m[11] = 0;

		m[12] = 0;
		m[13] = 0;
		m[14] = 0;
		m[15] = 1;

		return result;
	};

	// ### GL.Matrix.lookAt(ex, ey, ez, cx, cy, cz, ux, uy, uz[, result])
	//
	// Returns a matrix that puts the camera at the eye point `ex, ey, ez` looking
	// toward the center point `cx, cy, cz` with an up direction of `ux, uy, uz`.
	// You can optionally pass an existing matrix in `result` to avoid allocating
	// a new matrix. This emulates the OpenGL function `gluLookAt()`.
	Matrix.lookAt = function (ex, ey, ez, cx, cy, cz, ux, uy, uz, result) {
		result = result || new Matrix();
		var m = result.m;

		var e = new Vector(ex, ey, ez);
		var c = new Vector(cx, cy, cz);
		var u = new Vector(ux, uy, uz);
		var f = e.subtract(c).unit();
		var s = u.cross(f).unit();
		var t = f.cross(s).unit();

		m[0] = s.x;
		m[1] = s.y;
		m[2] = s.z;
		m[3] = -s.dot(e);

		m[4] = t.x;
		m[5] = t.y;
		m[6] = t.z;
		m[7] = -t.dot(e);

		m[8] = f.x;
		m[9] = f.y;
		m[10] = f.z;
		m[11] = -f.dot(e);

		m[12] = 0;
		m[13] = 0;
		m[14] = 0;
		m[15] = 1;

		return result;
	};

	// src/raytracer.js
	// Provides a convenient raytracing interface.
	// ### new GL.HitTest([t, hit, normal])
	//
	// This is the object used to return hit test results. If there are no
	// arguments, the constructed argument represents a hit infinitely far
	// away.


	function HitTest(t, hit, normal) {
		this.t = arguments.length ? t : Number.MAX_VALUE;
		this.hit = hit;
		this.normal = normal;
	}

	// ### .mergeWith(other)
	//
	// Changes this object to be the closer of the two hit test results.
	HitTest.prototype = {
		mergeWith: function mergeWith(other) {
			if (other.t > 0 && other.t < this.t) {
				this.t = other.t;
				this.hit = other.hit;
				this.normal = other.normal;
			}
		}
	};

	// ### new GL.Raytracer()
	//
	// This will read the current modelview matrix, projection matrix, and viewport,
	// reconstruct the eye position, and store enough information to later generate
	// per-pixel rays using `getRayForPixel()`.
	//
	// Example usage:
	//
	//     var tracer = new GL.Raytracer();
	//     var ray = tracer.getRayForPixel(
	//       gl.canvas.width / 2,
	//       gl.canvas.height / 2);
	//     var result = GL.Raytracer.hitTestSphere(
	//       tracer.eye, ray, new GL.Vector(0, 0, 0), 1);


	function Raytracer() {
		var v = gl.getParameter(gl.VIEWPORT);
		var m = gl.modelviewMatrix.m;

		var axisX = new Vector(m[0], m[4], m[8]);
		var axisY = new Vector(m[1], m[5], m[9]);
		var axisZ = new Vector(m[2], m[6], m[10]);
		var offset = new Vector(m[3], m[7], m[11]);
		this.eye = new Vector(-offset.dot(axisX), -offset.dot(axisY), -offset.dot(axisZ));

		var minX = v[0],
		    maxX = minX + v[2];
		var minY = v[1],
		    maxY = minY + v[3];
		this.ray00 = gl.unProject(minX, minY, 1).subtract(this.eye);
		this.ray10 = gl.unProject(maxX, minY, 1).subtract(this.eye);
		this.ray01 = gl.unProject(minX, maxY, 1).subtract(this.eye);
		this.ray11 = gl.unProject(maxX, maxY, 1).subtract(this.eye);
		this.viewport = v;
	}

	Raytracer.prototype = {
		// ### .getRayForPixel(x, y)
		//
		// Returns the ray originating from the camera and traveling through the pixel `x, y`.
		getRayForPixel: function getRayForPixel(x, y) {
			x = (x - this.viewport[0]) / this.viewport[2];
			y = 1 - (y - this.viewport[1]) / this.viewport[3];
			var ray0 = Vector.lerp(this.ray00, this.ray10, x);
			var ray1 = Vector.lerp(this.ray01, this.ray11, x);
			return Vector.lerp(ray0, ray1, y).unit();
		}
	};

	// ### GL.Raytracer.hitTestBox(origin, ray, min, max)
	//
	// Traces the ray starting from `origin` along `ray` against the axis-aligned box
	// whose coordinates extend from `min` to `max`. Returns a `HitTest` with the
	// information or `null` for no intersection.
	//
	// This implementation uses the [slab intersection method](http://www.siggraph.org/education/materials/HyperGraph/raytrace/rtinter3.htm).
	Raytracer.hitTestBox = function (origin, ray, min, max) {
		var tMin = min.subtract(origin).divide(ray);
		var tMax = max.subtract(origin).divide(ray);
		var t1 = Vector.min(tMin, tMax);
		var t2 = Vector.max(tMin, tMax);
		var tNear = t1.max();
		var tFar = t2.min();

		if (tNear > 0 && tNear < tFar) {
			var epsilon = 1.0e-6,
			    hit = origin.add(ray.multiply(tNear));
			min = min.add(epsilon);
			max = max.subtract(epsilon);
			return new HitTest(tNear, hit, new Vector((hit.x > max.x) - (hit.x < min.x), (hit.y > max.y) - (hit.y < min.y), (hit.z > max.z) - (hit.z < min.z)));
		}

		return null;
	};

	// ### GL.Raytracer.hitTestSphere(origin, ray, center, radius)
	//
	// Traces the ray starting from `origin` along `ray` against the sphere defined
	// by `center` and `radius`. Returns a `HitTest` with the information or `null`
	// for no intersection.
	Raytracer.hitTestSphere = function (origin, ray, center, radius) {
		var offset = origin.subtract(center);
		var a = ray.dot(ray);
		var b = 2 * ray.dot(offset);
		var c = offset.dot(offset) - radius * radius;
		var discriminant = b * b - 4 * a * c;

		if (discriminant > 0) {
			var t = (-b - Math.sqrt(discriminant)) / (2 * a),
			    hit = origin.add(ray.multiply(t));
			return new HitTest(t, hit, hit.subtract(center).divide(radius));
		}

		return null;
	};

	// ### GL.Raytracer.hitTestTriangle(origin, ray, a, b, c)
	//
	// Traces the ray starting from `origin` along `ray` against the triangle defined
	// by the points `a`, `b`, and `c`. Returns a `HitTest` with the information or
	// `null` for no intersection.
	Raytracer.hitTestTriangle = function (origin, ray, a, b, c) {
		var ab = b.subtract(a);
		var ac = c.subtract(a);
		var normal = ab.cross(ac).unit();
		var t = normal.dot(a.subtract(origin)) / normal.dot(ray);

		if (t > 0) {
			var hit = origin.add(ray.multiply(t));
			var toHit = hit.subtract(a);
			var dot00 = ac.dot(ac);
			var dot01 = ac.dot(ab);
			var dot02 = ac.dot(toHit);
			var dot11 = ab.dot(ab);
			var dot12 = ab.dot(toHit);
			var divide = dot00 * dot11 - dot01 * dot01;
			var u = (dot11 * dot02 - dot01 * dot12) / divide;
			var v = (dot00 * dot12 - dot01 * dot02) / divide;
			if (u >= 0 && v >= 0 && u + v <= 1) return new HitTest(t, hit, normal);
		}

		return null;
	};

	return GL;
}();

module.exports = GL;

},{}],59:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toArray = toArray;
/* converts input data to array if it is not already an array*/
function toArray(data) {
  if (!data) return [];
  if (data.constructor !== Array) return [data];
  return data;
}

},{}]},{},[53]);
