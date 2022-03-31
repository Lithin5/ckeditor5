/**
 * @license Copyright (c) 2003-2022, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module engine/model/utils/insertobject
 */

import first from '@ckeditor/ckeditor5-utils/src/first';
import CKEditorError from '@ckeditor/ckeditor5-utils/src/ckeditorerror';

/**
 * Inserts an {@glink framework/guides/deep-dive/schema#object-elements object element} at a specific position in the editor content.
 *
 * **Note:** Use {@link module:engine/model/model~Model#insertObject} instead of this function.
 * This function is only exposed to be reusable in algorithms which change the {@link module:engine/model/model~Model#insertObject}
 * method's behavior.
 *
 * **Note**: For more documentation and examples, see {@link module:engine/model/model~Model#insertObject}.
 *
 * @param {module:engine/model/model~Model} model The model in context of which the insertion
 * should be performed.
 * @param {module:engine/model/element~Element} object An object to be inserted into the model document.
 * @param {module:engine/model/selection~Selectable} [selectable=model.document.selection]
 * A selectable where the content should be inserted. If not specified, the current
 * {@link module:engine/model/document~Document#selection document selection} will be used instead.
 * @param {Number|'before'|'end'|'after'|'on'|'in'} placeOrOffset Specifies the exact place or offset for the insertion to take place,
 * relative to `selectable`.
 * @param {Object} [options] Additional options.
 * @param {'auto'|'before'|'after'} [options.findOptimalPosition] An option that, when set, adjusts the insertion position (relative to
 * `selectable` and `placeOrOffset`) so that the content of `selectable` is not split upon insertion (a.k.a. non-destructive insertion).
 * * When `'auto'`, the algorithm will decide whether to insert the object before or after `selectable` to avoid content splitting.
 * * When `'before'`, the closest position before `selectable` will be used that will not result in content splitting.
 * * When `'after'`, the closest position after `selectable` will be used that will not result in content splitting.
 *
 * Note that this option works only for block objects. Inline objects are inserted into text and do not split blocks.
 * @param {'on'|'after'} [options.setSelection] An option that, when set, moves the
 * {@link module:engine/model/document~Document#selection document selection} after inserting the object.
 * * When `'on'`, the document selection will be set on the inserted object.
 * * When `'after'`, the document selection will move to the closest text node after the inserted object. If there is no
 * such text node, a paragraph will be created and the document selection will be moved inside it.
 * @returns {module:engine/model/range~Range} A range which contains all the performed changes. This is a range that, if removed,
 * would return the model to the state before the insertion. If no changes were preformed by `insertObject()`, returns a range collapsed
 * at the insertion position.
 */
export default function insertObject( model, object, selectable, placeOrOffset, options = {} ) {
	if ( !model.schema.isObject( object ) ) {
		/**
		 * Tried to insert an element by {@link module:engine/model/utils/insertobject insertObject()} function
		 * that is not defined as an object in schema.
		 * See {@link module:engine/model/schema~SchemaItemDefinition#isObject `SchemaItemDefinition`}.
		 * @error insertobject-element-not-an-object
		 */
		throw new CKEditorError( 'insertobject-element-not-an-object', model, { object } );
	}

	// Normalize selectable to a selection instance.
	let originalSelection;

	if ( !selectable ) {
		originalSelection = model.document.selection;
	} else if ( selectable.is( 'selection' ) ) {
		originalSelection = selectable;
	} else {
		originalSelection = model.createSelection( selectable, placeOrOffset );
	}

	// Adjust the insertion selection.
	let insertionSelection = originalSelection;

	if ( options.findOptimalPosition && model.schema.isBlock( object ) ) {
		insertionSelection = model.createSelection( findOptimalInsertionRange( originalSelection, model, options.findOptimalPosition ) );
	}

	// Collect attributes to be copied on the inserted object.
	const firstSelectedBlock = first( originalSelection.getSelectedBlocks() );
	const attributesToCopy = {};

	if ( firstSelectedBlock ) {
		Object.assign( attributesToCopy, model.schema.getAttributesWithProperty( firstSelectedBlock, 'copyOnReplace', true ) );
	}

	return model.change( writer => {
		// Remove the selected content to find out what the parent of the inserted object would be.
		// It would be removed inside model.insertContent() anyway.
		if ( !insertionSelection.isCollapsed ) {
			model.deleteContent( insertionSelection, { doNotAutoparagraph: true } );
		}

		let elementToInsert = object;
		const insertionPositionParent = insertionSelection.anchor.parent;

		// Autoparagraphing of an inline objects.
		if (
			!model.schema.checkChild( insertionPositionParent, object ) &&
			model.schema.checkChild( insertionPositionParent, 'paragraph' ) &&
			model.schema.checkChild( 'paragraph', object )
		) {
			elementToInsert = writer.createElement( 'paragraph' );

			writer.insert( object, elementToInsert );
		}

		// Apply attributes that are allowed on the inserted object (or paragraph if autoparagraphed).
		model.schema.setAllowedAttributes( elementToInsert, attributesToCopy, writer );

		// Insert the prepared content at the optionally adjusted selection.
		const affectedRange = model.insertContent( elementToInsert, insertionSelection );

		// Nothing got inserted.
		if ( affectedRange.isCollapsed ) {
			return affectedRange;
		}

		if ( options.setSelection ) {
			updateSelection( writer, object, options.setSelection, attributesToCopy );
		}

		return affectedRange;
	} );
}

// TODO findOptimalInsertionRange should be exported or exposed in some reasonable place to be used in the widget util of the same name.

/**
 * Returns a model range which is optimal (in terms of UX) for inserting a widget block.
 *
 * For instance, if a selection is in the middle of a paragraph, the collapsed range before this paragraph
 * will be returned so that it is not split. If the selection is at the end of a paragraph,
 * the collapsed range after this paragraph will be returned.
 *
 * Note: If the selection is placed in an empty block, the range in that block will be returned. If that range
 * is then passed to {@link module:engine/model/model~Model#insertContent}, the block will be fully replaced
 * by the inserted widget block.
 *
 * @param {module:engine/model/selection~Selection|module:engine/model/documentselection~DocumentSelection} selection
 * The selection based on which the insertion position should be calculated.
 * @param {module:engine/model/model~Model} model Model instance.
 * @param {'auto'|'before'|'after'} [place='auto'] Place where to look for optimal insertion range.
 * Default value `auto` will determine itself the best position for insertion.
 * Value `before` will try to find a position before selection.
 * Value `after` will try to find a position after selection.
 * @returns {module:engine/model/range~Range} The optimal range.
 */
export function findOptimalInsertionRange( selection, model, place = 'auto' ) {
	const selectedElement = selection.getSelectedElement();

	if ( selectedElement && model.schema.isObject( selectedElement ) && !model.schema.isInline( selectedElement ) ) {
		if ( [ 'before', 'after' ].includes( place ) ) {
			return model.createRange( model.createPositionAt( selectedElement, place ) );
		}

		return model.createRangeOn( selectedElement );
	}

	const firstBlock = first( selection.getSelectedBlocks() );

	// There are no block elements within ancestors (in the current limit element).
	if ( !firstBlock ) {
		return model.createRange( selection.focus );
	}

	// If inserting into an empty block – return position in that block. It will get
	// replaced with the image by insertContent(). #42.
	if ( firstBlock.isEmpty ) {
		return model.createRange( model.createPositionAt( firstBlock, 0 ) );
	}

	const positionAfter = model.createPositionAfter( firstBlock );

	// If selection is at the end of the block - return position after the block.
	if ( selection.focus.isTouching( positionAfter ) ) {
		return model.createRange( positionAfter );
	}

	// Otherwise, return position before the block.
	return model.createRange( model.createPositionBefore( firstBlock ) );
}

/**
 * Updates document selection based on given `place` parameter in relation to `contextElement` element.
 *
 * @param {module:engine/model/writer~Writer} writer An instance of the model writer.
 * @param {module:engine/model/element~Element} contextElement An element to set attributes on.
 * @param {'on'|'after'} place Place where selection should be set in relation to `contextElement` element.
 * Value `on` will set selection on passed `contextElement`. Value `after` will set selection after `contextElement`.
 * @param {Object} attributes Attributes keys and values to set on a paragraph that this function can create when
 * `place` parameter is equal to `after` but there is no element with `$text` node to set selection in.
 *
 * @private
 */
function updateSelection( writer, contextElement, place, paragraphAttributes ) {
	const model = writer.model;

	if ( place == 'after' ) {
		let nextElement = contextElement.nextSibling;

		// Check whether an element next to the inserted element is defined and can contain a text.
		const canSetSelection = nextElement && model.schema.checkChild( nextElement, '$text' );

		// If the element is missing, but a paragraph could be inserted next to the element, let's add it.
		if ( !canSetSelection && model.schema.checkChild( contextElement.parent, 'paragraph' ) ) {
			nextElement = writer.createElement( 'paragraph' );

			model.schema.setAllowedAttributes( nextElement, paragraphAttributes, writer );
			model.insertContent( nextElement, writer.createPositionAfter( contextElement ) );
		}

		// Put the selection inside the element, at the beginning.
		if ( nextElement ) {
			writer.setSelection( nextElement, 0 );
		}
	}
	else if ( place == 'on' ) {
		writer.setSelection( contextElement, 'on' );
	}
	else {
		/**
		 * Unsupported `place` parameter was passed to the {@link module:engine/model/utils/insertobject insertObject()} function.
		 * Check {@link module:engine/model/utils/insertobject insertObject()} API documentation for allowed `place` parameter values.
		 *
		 * @error insertobject-invalid-place-parameter-value
		 */
		throw new CKEditorError( 'insertobject-invalid-place-parameter-value', model );
	}
}
