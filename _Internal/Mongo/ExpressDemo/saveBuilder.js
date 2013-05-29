var mongodb = require('mongodb');
var ObjectId = require('mongodb').ObjectID;



exports.saveChanges = function(db, req, res) {
    var body = req.body;
    var saveHandler = new SaveHandler(db, body.entities, body.saveOptions, body.metadata, function(saveResult) {
        res.send(saveResult);
    });

}

var SaveHandler = function(db, entities, saveOptions, metadata, saveCompletedCallback) {
    this.db = db;
    this.entities = entities;
    this.saveOptions = saveOptions;
    this.metadata = metadata;
    this.saveCountPending = 0;
    this.allCallsCompleted = false;
    this.saveCompletedCallback = saveCompletedCallback;
    this.insertedEntities = [];
    this.updatedKeys = [];
    this.deletedKeys = [];
    this.keyMappings = [];
    this._save();
}

SaveHandler.prototype._save = function(saveCompletedCallback) {
    var groupedEntities = groupBy(this.entities, function(e) {
        return e.entityAspect.defaultResourceName;
    });
    var that = this;
    objectForEach(groupedEntities, that._saveToCollection.bind(that));
    this.allCallsCompleted = true;
}

SaveHandler.prototype._saveToCollection = function(resourceName, entities) {
    var insertDocs = [];
    var updateDocs = [];
    var deleteDocs = [];
    var that = this;
    entities.forEach(function(e) {
        var entityAspect = e.entityAspect;
        var entityState = entityAspect.entityState;
        var entityTypeName = entityAspect.entityTypeName;
        that.coerceData(e, that.metadata[entityTypeName]);
        if (entityState === "Added") {
            delete e.entityAspect;
            var tempValue = e._id;
            // if (autogenerated) then we want to omit the "_id" in the insertDoc
            var autoGeneratedKey = entityAspect.autoGeneratedKey;
            if (autoGeneratedKey && autoGeneratedKey.propertyName == "_id") {
                delete e._id;
            }
            var insertDoc = { entity: e, keyMapping: { entityTypeName: entityTypeName, tempValue: tempValue }}  ;
            insertDocs.push(insertDoc);
        } else if (entityState === "Modified") {
            var criteria = { "_id": e._id };
            setMap = {};
            Object.keys(entityAspect.originalValuesMap).forEach(function(k) {
                setMap[k] = e[k];
            });
            var updateDoc = { criteria: criteria, setOps: { $set: setMap }, entityKey: { entityTypeName: entityAspect.entityTypeName, key: e._id } };
            updateDocs.push(updateDoc);
        } else if (entityState = "Deleted") {
            var criteria = { "_id": e._id };
            var deleteDoc = { criteria: criteria,  entityKey: { entityTypeName: entityAspect.entityTypeName, key: e._id } };
            deleteDocs.push(deleteDoc);
        }
    });
    this.saveCountPending += insertDocs.length + updateDocs.length + deleteDocs.length;

    this.db.collection(resourceName, {strict: true} , function (err, collection) {
        insertDocs.forEach(function (iDoc) {
            collection.insert(iDoc.entity, function(err, object) {
                that._handleInsert(iDoc, err, object);
            });
        });
        updateDocs.forEach(function (uDoc) {
            collection.update( uDoc.criteria, uDoc.setOps, function(err, object) {
                that._handleUpdate(uDoc, err, object);
            })
        });
        deleteDocs.forEach(function (dDoc) {
            collection.remove( dDoc.criteria, true, function(err, object) {
                that._handleDelete(dDoc, err, object);
            })
        });
    });
}

SaveHandler.prototype.coerceData = function(entity, entityType) {
    entityType.dataProperties.forEach(function(dp) {
        var dt = dp.dataType;
        if (dt === "DateTime" || dt === "DateTimeOffset") {
            var val = entity[dp.name];
            if (val) {
                entity[dp.name] = new Date(Date.parse(val));
            }
        }
    })
}

SaveHandler.prototype._handleInsert = function(insertDoc, err, objects) {
    if (this._checkIfError(err)) return;
    var insertedEntity = objects[0];
    this.insertedEntities.push(insertedEntity);
    var keyMapping = insertDoc.keyMapping;
    if (keyMapping.tempValue !== insertedEntity._id) {
        keyMapping.realValue = insertedEntity._id;
        this.keyMappings.push(keyMapping);
    }
    this._checkIfCompleted();
}

SaveHandler.prototype._handleUpdate = function (updateDoc, err, object) {
    if (this._checkIfError(err)) return;
    this.updatedKeys.push( updateDoc.entityKey );
    this._checkIfCompleted();
}

SaveHandler.prototype._handleDelete = function (deleteDoc, err, object) {
    if (this._checkIfError(err)) return;
    this.deletedKeys.push( deleteDoc.entityKey );
    this._checkIfCompleted();
}

SaveHandler.prototype._checkIfError = function(err) {
    if (err) {
        this.saveCompletedCallback(err);
    }
    return err != null;
}

SaveHandler.prototype._checkIfCompleted = function() {
    this.saveCountPending -= 1;
    if (this.saveCountPending <= 0 && this.allCallsCompleted) {
        this.saveCompletedCallback( {
            insertedEntities: this.insertedEntities,
            updatedKeys: this.updatedKeys,
            deletedKeys: this.deletedKeys,
            keyMappings: this.keyMappings
        });
    }
}

function objectForEach(obj, kvFn) {
    for (var key in obj) {
        if ( obj.hasOwnProperty(key)) {
            kvFn(key, obj[key]);
        }
    }
}

function groupBy(arr, keyFn) {
    var groups = {};
    arr.forEach(function (v) {
        var key = keyFn(v);
        var group = groups[key];
        if (!group) {
            group = [];
            groups[key] = group;
        }
        group.push(v);
    })
    return groups;
}