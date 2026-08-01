jQuery(document).ready(function($) {
	// ______________________________________________________________

	if ($("#scrip") && $("#scrip").select2) {
		$("#scrip").select2();
		$("#exchange,#product").on("change", function() {
			$("#scrip").select2();
		});
	}

	// if banner is present, add class to body and attach event listener to close banner
	var banner = document.getElementsByClassName('web-banner')
	if (banner && banner[0]) {
		document.getElementsByTagName("body")[0].classList.add("banner-on")
		document.getElementsByClassName("close-banner")[0].addEventListener("click", function () {
			document.getElementsByTagName("body")[0].classList.remove("banner-on")
		})
	}
	// ___ sticky header on insider table
	if( $('#table-header').length > 0) {
		var top = $('#table-header').offset().top;
		$(document).scroll(function() {
			var me = $('#table-header');

			if( $(document).scrollTop() > top) {
				if(!window.header_sticky) {
					me.css('width', me.parent().outerWidth() + 'px');
					me.addClass('sticky');
					window.header_sticky = true;
				}
			} else if(window.header_sticky) {
				me.removeClass('sticky');
				me.css('width', '100%');
				window.header_sticky = false;
			}
		});
	}

	if($('#table').length > 0) {

		$("#table").tablesorter();

		$('#table-header th').click(function() {
			var index = $(this).index();

			if($(this).data('direction') == 'desc') {
	        	var sorting = [[index, 1]];
	        	$(this).data('direction', 'asc');
			} else {
				var sorting = [[index, 0]];
				$(this).data('direction', 'desc');
			}

			$("#table").trigger("sorton", [sorting]);

			return false;
		});
	}

	// tooltips
	$('.tip').each(function() {
		$(this).tinytooltip({
			message:  $(this).data('tip') 
		});
	});

	// ______________________________________________________________

	Calculator.init();
});



// ______________________________________________________________
var Calculator = new function() {

	// public methods
	this.init = function() {
		Me.init();
	};

	// _______________ core
	var Me = {
		span_query: [],
		spans: [],
		span_total: 0,

		init: function() {

			// search
			$('#q').on('keyup keydown', function() {
				Me.searchScrip( $.trim($(this).val()).toUpperCase() );
			});
			$('#search').submit(function() {
				return false;
			});

			// show popup
			$('.calculate').click(function() {
				var id = $(this).data('id');

				switch(MODULE) {
					case 'Equity':
						Me.showEquityPopup(id);
					break;
					case 'Futures':
						Me.showFuturesPopup(id);
					break;
					case 'Currency':
						Me.showCDSPopup(id);
					break;
					case 'Commodity':
						Me.showCommodityPopup(id);
					break;
				}
				return false;
			});

			// close popup
			$('.popup .close').click(function() {
				$('.popup').hide();
				// $(this).blur();
				// $(this).parent().fadeOut(200);
				return false;
			});
			$(document).keypress(function(e) {
				if(e.keyCode == 27) {
					$('.popup').hide();
				}
			});
			window.onclick = function(event) {
				if (event.target == document.getElementsByClassName("popup")[0]) {
				  $('.popup').hide();
				}
			}

			// equity calculation
			$('#form-equity').submit(function() {
				Me.calculateEquity();
				return false;
			});

			// futures calculation
			$('#form-futures').submit(function() {
				Me.calculateFutures();
				return false;
			});

			// commodity calculation
			$('#form-commodity').submit(function() {
				Me.calculateCommodity();
				return false;
			});

			// currency calculation
			$('#form-cds').submit(function() {
				Me.calculateCDS();
				return false;
			});

			// __________________


			if(MODULE == "SPAN") {
				Me.initSPAN();

				$('#reset').click(function() {
					document.location.reload();
				});
			}

			if(MODULE == "BracketCover") {
				Me.initBOCO();

				$('#reset').click(function() {
					document.location.reload();
				});
			}
		},

		// __ quick search list of scrips
		searchScrip: function(q) {
			if(!q) {
				$('#table tbody tr').show();
				return false;
			}

			if(q.length < 2 || window.prev && window.prev == q) return false;

			var list = $('#table tbody');
				list.find("tr").hide();
				list.find("tr[data-scrip*='"+ q +"']").show();
		},

		// __ show popup calculator
		showEquityPopup: function(id) {
			var cont = $('#entry-' + id);
			var scrip = $(cont).data('scrip'),
				segment = $(cont).data('segment'),
				mis_margin = $(cont).data('mis_margin'),
				mis_multiplier = $(cont).data('mis_multiplier'),
				co_margin = $(cont).data('co_margin'),
				co_multiplier = $(cont).data('co_multiplier');

			var popup = $('#popup-equity').data('id', id);
				popup.find('.scrip').text(scrip);
				popup.find('.mis_multiplier').text(mis_multiplier + 'x');
				popup.find('.co_multiplier').text(co_multiplier + 'x');

			$('#form-equity').submit();
			popup.fadeIn(200);
		},
		calculateEquity: function() {
			var entry = $('#entry-' + $('#popup-equity').data('id'));

			var cash = parseFloat( $.trim( $('#popup-equity .cash').val() ) ),
				price = parseFloat( $.trim( $('#popup-equity .price').val() ) ),
				mis_margin = parseFloat( entry.data('mis_margin') ),
				co_margin = parseFloat( entry.data('co_margin') );

			if(isNaN(cash)) {
				cash = 100000;
				$('#popup-equity .cash').val(cash);
			}

			if(isNaN(price)) {
				price = 100;
				$('#popup-equity .price').val(price);
			}

			// single share
			var mis_single = (price * mis_margin) / 100,
				mis_power = Math.floor(cash / mis_single),
				co_single = (price * co_margin) / 100,
				co_power = Math.floor(cash / co_single);
				cnc_power = Math.floor(cash / price);

			$('#popup-equity .cnc_power').text( !isNaN(cnc_power) && isFinite(cnc_power) ? cnc_power : 0);
			$('#popup-equity .mis_power').text( !isNaN(mis_power) && isFinite(mis_power) ? mis_power : 0);
			$('#popup-equity .co_power').text( !isNaN(co_power) && isFinite(co_power) ? co_power : 0);

			return false;
		},

		// futures
		// __ show popup calculator
		showFuturesPopup: function(id) {
			var cont = $('#entry-' + id);
			var scrip = $(cont).data('scrip'),
				lot_size = $(cont).data('lot_size'),
				expiry = $(cont).data('expiry'),
				nrml_margin = $(cont).data('nrml_margin'),
				mis_margin = $(cont).data('mis_margin'),
				co_margin = $(cont).data('co_margin'),
				price = $(cont).data('price');

			var popup = $('.popup').data('id', id);
				popup.find('.scrip').text(scrip + ': ' + expiry);
				popup.find('.mis_margin').text(mis_margin);
				popup.find('.co_margin').text(co_margin);
				popup.find('.nrml_margin').text(nrml_margin);
				popup.find('.price').val(price);

			$('#form-futures').submit();
			popup.fadeIn(200);
		},
		calculateFutures: function() {
			var entry = $('#entry-' + $('.popup').data('id'));
			var popup = $('.popup');

			var cash = parseFloat( $.trim( popup.find('.cash').val() ) ),
				price = parseFloat( $.trim( popup.find('.price').val() ) ),

				margin = parseFloat( entry.data('margin') ),
				lot_size = parseInt( entry.data('lot_size') ),
				co_trigger = parseFloat( entry.data('co_trigger') ),
			
				expiry = entry.data('expiry');

			if(isNaN(cash)) {
				cash = 100000;
				popup.find('.cash').val(cash);
			}

			if(isNaN(price)) {
				price = 100;
				popup.find('.price').val(price);
			}


			var nrml_margin = (price * lot_size * margin) / 100,
				mis_margin = nrml_margin * 0.45,
				co_margin = ((price * lot_size) * co_trigger / 100);

			if($('h1.scrip').text().indexOf("NIFTY") != -1) {
				mis_margin = nrml_margin * .35;
			}

			// single share
			var nrml_power = Math.floor(cash/nrml_margin),
				mis_power = Math.floor(cash/mis_margin),
				co_power = Math.floor(cash/co_margin);

			popup.find('.nrml_power').text( !isNaN(nrml_power) && isFinite(nrml_power) ? nrml_power : 'N/A');
			popup.find('.mis_power').text( !isNaN(mis_power) && isFinite(mis_power) ? mis_power : 'N/A');
			popup.find('.co_power').text( !isNaN(co_power) && isFinite(co_power) ? co_power : 'N/A');
			popup.find('.price').text( !isNaN(price) && isFinite(price) ? price : 'N/A');

			popup.find('.mis_margin').text( Math.floor(mis_margin) );
			popup.find('.co_margin').text( Math.floor(co_margin) == 0 ? 'N/A' : Math.floor(co_margin));
			popup.find('.nrml_margin').text( Math.floor(nrml_margin) );

			return false;
		},

		// cds
		// __ show popup calculator
		showCDSPopup: function(id) {

			var cont = $('#entry-' + id);
			var scrip = $(cont).data('scrip'),
				lot_size = $(cont).data('lot_size'),
				expiry = $(cont).data('expiry'),
				nrml_margin = $(cont).data('nrml_margin'),
				mis_margin = $(cont).data('mis_margin'),
				co_margin = $(cont).data('co_margin'),
				price = $(cont).data('price');

			var popup = $('.popup').data('id', id);
				popup.find('.scrip').text(scrip + ': ' + expiry);
				popup.find('.mis_margin').text(mis_margin);
				popup.find('.co_margin').text(co_margin);
				popup.find('.nrml_margin').text(nrml_margin);
				popup.find('.price').val(price);

			$('#form-cds').submit();
			popup.fadeIn(200);
		},
		calculateCDS: function() {
			var entry = $('#entry-' + $('.popup').data('id'));
			var popup = $('.popup');

			var cash = parseFloat( $.trim( popup.find('.cash').val() ) ),
				price = parseFloat( $.trim( popup.find('.price').val() ) ),

				margin = parseFloat( entry.data('margin') ),
				lot_size = parseInt( entry.data('lot_size') ),
				co_trigger = parseFloat( entry.data('co_trigger') ),
			
				expiry = entry.data('expiry');


			if(isNaN(cash)) {
				cash = 100000;
				popup.find('.cash').val(cash);
			}

			if(isNaN(price)) {
				price = 100;
				popup.find('.price').val(price);
			}


			var nrml_margin = (price * lot_size * margin) / 100,
				mis_margin = nrml_margin * 0.5,
				co_margin = ((price * lot_size) * co_trigger / 100);

			// single share
			var nrml_power = Math.floor(cash/nrml_margin),
				mis_power = Math.floor(cash/mis_margin),
				co_power = Math.floor(cash/co_margin);

			popup.find('.nrml_power').text( !isNaN(nrml_power) && isFinite(nrml_power) ? nrml_power : 'N/A');
			popup.find('.mis_power').text( !isNaN(mis_power) && isFinite(mis_power) ? mis_power : 'N/A');
			popup.find('.co_power').text( !isNaN(co_power) && isFinite(co_power) ? co_power : 'N/A');
			popup.find('.price').text( !isNaN(price) && isFinite(price) ? price : 'N/A');

			popup.find('.mis_margin').text( Math.floor(mis_margin) );
			popup.find('.co_margin').text( Math.floor(co_margin) == 0 ? 'N/A' : Math.floor(co_margin));
			popup.find('.nrml_margin').text( Math.floor(nrml_margin) );

			return false;
		},


		// commodity
		// __ show popup calculator
		showCommodityPopup: function(id) {
			var cont = $('#entry-' + id);
			var scrip = $(cont).data('scrip'),
				lot_size = $(cont).data('lot_size'),
				nrml_margin = $(cont).data('nrml_margin'),
				mis_margin = $(cont).data('mis_margin'),
				price = $(cont).data('price');

			var popup = $('.popup').data('id', id);
				popup.find('.scrip').text(scrip);
				popup.find('.mis_margin').text(mis_margin);
				popup.find('.nrml_margin').text(nrml_margin);
				popup.find('.price').val(price);

			$('#form-commodity').submit();
			popup.fadeIn(200);
		},
		calculateCommodity: function() {
			var entry = $('#entry-' + $('.popup').data('id'));
			var popup = $('.popup');

			var cash = parseFloat( $.trim( popup.find('.cash').val() ) ),
				price = parseFloat( $.trim( popup.find('.price').val() ) ),

				margin = parseFloat( entry.data('margin') ),
				lot_size = parseInt( entry.data('lot_size') );

			if(isNaN(cash)) {
				cash = 100000;
				popup.find('.cash').val(cash);
			}

			if(isNaN(price)) {
				price = 100;
				popup.find('.price').val(price);
			}

			var nrml_margin = (price * lot_size * margin) / 100,
				mis_margin = nrml_margin * 0.5;

			// single share
			var nrml_power = Math.floor(cash/nrml_margin),
				mis_power = Math.floor(cash/mis_margin);

			popup.find('.nrml_power').text( !isNaN(nrml_power) && isFinite(nrml_power) ? nrml_power : 'N/A');
			popup.find('.mis_power').text( !isNaN(mis_power) && isFinite(mis_power) ? mis_power : 'N/A');
			popup.find('.price').text( !isNaN(price) && isFinite(price) ? price : 'N/A');

			popup.find('.mis_margin').text( Math.floor(mis_margin) );
			popup.find('.nrml_margin').text( Math.floor(nrml_margin) );

			return false;
		},

		// _____________ SPAN calculator
		initSPAN: function() {
			// ui control interactions
			// exchange
			
			$('.changer').change(function() {
				var show = $(this).find('option:selected').data('show'),
					hide = $(this).find('option:selected').data('hide');
				if(hide) {
					$(hide).hide();
				}

				if(show) {
					$(show).show();
				}
			}).change();

			// exchange data
			$('#exchange').change(function() {
				Me.populateSPANui($('#exchange').val());
				$('#scrip').change();
			}).change();

			// scrip lot size
			$('#scrip').change(function() {
				var lz = $(this).find('option:selected').data('lot_size');
				var unit = $(this).find('option:selected').data('unit');
				if(lz) {
					if (unit) {
						$('#lot_size .val').text(unit);
					} else {
						$('#lot_size .val').text(lz);
					}
					$('#qty').val(lz);
				}
			}).change();

			// add span calculation
			$('#form-span').submit(function() {
				Me.addSPAN();
				return false;
			});

			// delete table items
			$('#table-span tbody').on('click', '.x', function() {

				var id = $(this).parents('tr:first').index();

				$('#table-span tbody tr:eq(' + id + ')').hide();

				Me.deleteSpanItem(id);

				if(Me.spans.length != 0) {
					Me.fetchSPAN(Me.spans.length-1);
				} else {
					$('#tally .val').text('0');
					$('#table-span tfoot').hide();
				}

				return false;
			});

			// table rendering directives
			Me.directives = {
				exchange: {
					html: function(e) {
						return $(e.element).text() + ' <a href="#" class="x">x</a>';
					}
				},
				qty: {
					text: function(e) {
						return this.qty + " " + this.trade[0].toUpperCase();
					}
				},
				strike_price: {
					text: function() {
						if(!this.strike_price) {
							return 'N/A';
						}
						return this.strike_price + ' ' + this.option_type;
					}
				},
				span: {
					html: function(e) {
						return $(e.element).text() ? Me.numberFormat( parseFloat($(e.element).text()) ) : '<span class="loading"> </span>';
					}
				},
				exposure: {
					html: function(e) {
						return $(e.element).text() ? Me.numberFormat( parseFloat($(e.element).text()) ) : '<span class="loading"> </span>';
					}
				},
				total: {
					html: function(e) {
						return $(e.element).text() ? Me.numberFormat( parseFloat($(e.element).text()) ) : '<span class="loading"> </span>';
					}
				}
			};

		},
		populateSPANui: function(field) {
			switch(field) {
				case 'NFO':
					var sym = $('#scrip');
					sym.empty();
					for(var n=0; n<FUTURES.length; n++) {
						sym.append( $('<option>').val(FUTURES[n][0]).append(FUTURES[n][1]).data('lot_size', FUTURES[n][2]) );
					}
					$('#lot_size').show();
				break;
				case 'BFO':
					var sym = $('#scrip');
					sym.empty();
					for(var n=0; n<FUTURES.length; n++) {
						sym.append( $('<option>').val(FUTURES[n][0]).append(FUTURES[n][1]).data('lot_size', FUTURES[n][2]) );
					}
					$('#lot_size').show();
				break;
				case 'MCX':
					var sym = $('#scrip');
					sym.empty();
					for(var n=0; n<COMMODITIES.length; n++) {
						sym.append( $('<option>').val(COMMODITIES[n][0]).append(COMMODITIES[n][1])
						.data('lot_size', COMMODITIES[n][2])
						.data('unit', COMMODITIES[n][3]) );
					}
					$('#lot_size').show();
				break;
				case 'CDS':
					var sym = $('#scrip');
					sym.empty();
					for(var n=0; n<CURRENCIES.length; n++) {
						sym.append( $('<option>').val(CURRENCIES[n][0]).append(CURRENCIES[n][1]).data('lot_size', CURRENCIES[n][2]) );
					}
					$('#lot_size').hide();
				break;
			}
		},		

		// _________________________________

		addNewSPANitem: function(query, exchange, scrip, product, product_name, option_type, strike_price, qty, trade) {
			var strike = '';

			Me.spans.push({
				"exchange": exchange,
				"scrip": scrip,
				"product": product,
				"option_type": option_type,
				"product_name": product_name,
				"strike_price": strike_price,
				"qty": qty,
				"trade": trade,
				"query": query
			});

			$('#table-span tbody').render(Me.spans, Me.directives);

			return Me.spans.length-1;
		},

		spanItemExists: function(exchange, product, scrip, option_type, strike_price, trade) {
			var hay, needle;
			if(product == 'OPT') {
				var needle = exchange + product + scrip + option_type + strike_price;
			} else {
				var needle = exchange + product + scrip;
			}

			for(var n=0; n<Me.spans.length; n++) {
				if(product == 'OPT') {
					hay = Me.spans[n].exchange + Me.spans[n].product + Me.spans[n].scrip + Me.spans[n].option_type + Me.spans[n].strike_price;
				} else {
					hay = Me.spans[n].exchange + Me.spans[n].product + Me.spans[n].scrip;
				}

				if(hay  == needle) {
					return true;
				}
			}

			return false;
		},

		getSPANqueries: function() {
			var q = [];
			for(var n=0; n<Me.spans.length; n++) {
				q.push( Me.spans[n].query );
			}
			return q.join('&');
		},

		deleteSpanItem: function(id) {
			Me.spans.splice(id, 1);
		},

		refreshSPAN: function() {
			$('#table-span tbody').render(Me.spans, Me.directives);
			$('#table-span tbody *:hidden').show();
		},

		addSPAN: function() {
			// validation
			var qty = $('#qty').val();
			if(!qty || isNaN(qty*1)) {
				alert("Please enter a valid quantity");
				$('#qty').focus().select();
				return false;
			}
			qty = parseInt(qty);

			// negative qty
			if(qty < 0) {
				qty = Math.abs(qty);
				$('#qty').val(qty);
				$('#form-span .trade-sell').attr('checked', 1);
			}

			// lot size multiple
			var lot_size = parseInt( $('#scrip option:selected').data('lot_size') );
			if(!isNaN(lot_size) && lot_size > 0) {
				qty = Math.ceil(qty / lot_size) * lot_size;
			}
			$('#qty').val(qty);


			// strike price
			var strike_price = 0;
			if($('#product').val() == 'OPT' && $('#exchange').val() != 'MCX') {
				strike_price = $('#strike_price').val();

				if(!strike_price || isNaN(strike_price*1)) {
					alert("Please enter a valid strike price");
					$('#strike_price').focus().select();
					return false;
				}
				strike_price = parseFloat(strike_price);
			}

			// check if it already exists
			if(Me.spanItemExists(	$('#exchange').val(),
									$('#product').val(),
									$('#scrip').val(),
									$('#option_type').val(),
									strike_price,
									$('#form-span .trade:checked').val()
			)) {
				alert("You have already added this contract");
				return;
			}

			// ___________________________

			var query = $('#form-span').serialize();

			var strike_price;
			if( $('#product').val() == 'FUT') {
				strike_price = '';
			} else {
				strike_price = $('#strike_price').val();
			}

			var id = Me.addNewSPANitem(
						query,
						$('#exchange').val(),
						$('#scrip').val(),
						$('#product option:selected').val(),
						$('#product option:selected').data('name'),
						$('#option_type').val(),
						strike_price,
						qty,
						$('#form-span .trade:checked').val()
					);


			Me.fetchSPAN(id);
			$('#table-span').removeClass('invis');

			// ___________________________ fetch

		},
		
		fetchSPAN: function(id) {
			if(!Me.getSPANqueries()) {
				return false;
			}

			(function(id) {
				$.post(ROOT + MODULE, 'action=calculate&' + Me.getSPANqueries(), function(data) {
					if(!data || !data.hasOwnProperty("total")) {
						// an invalid entry, remove it. If not removed, Omnesys API will reject all subsequent calls
						$('#table-span tbody tr:eq(' + id + ') .loading').replaceWith('N/A');
						Me.deleteSpanItem(id);
						//Me.refreshSPAN();
					} else {
						// save the data to our store
						Me.spans[id].span = data.last.span;
						Me.spans[id].exposure = data.last.exposure;
						Me.spans[id].spread = data.last.spread;
						Me.spans[id].total = data.last.total;

						Me.refreshSPAN();

						Me.populateSPAN(data.total.span, data.total.exposure, data.total.spread, data.total.netoptionvalue, data.total.total);
					}
				}, "json");

			})(id);
		},

		populateSPAN: function(span, exposure, spread, netoptionvalue, total) {
			// calculate the raw span total
			var all_total = 0;
			for(var n=0; n<Me.spans.length; n++) {
				all_total += Me.spans[n].total;
			}

			$('#table-span tfoot').show();
			$('#table-span tfoot .total').text( Me.numberFormat(all_total) );


			// populate total box
			$('#tally .span').text( 'Rs. ' + Me.numberFormat(span) );
			$('#tally .exposure').text( 'Rs. ' + Me.numberFormat(exposure) );
			$('#tally .total').text( 'Rs. ' + Me.numberFormat(total) );

			if(netoptionvalue > 0) {
				$('#tally .netoptionvalue .val').text( 'Rs. ' + Me.numberFormat(netoptionvalue) );
				$('#tally .netoptionvalue').show();
			} else {
				$('#tally .netoptionvalue').hide();
			}

			if(spread > 0) {
				$('#tally .spread .val').text( 'Rs. ' + Me.numberFormat(spread) );
				$('#tally .spread').show();
			} else {
				$('#tally .spread').hide();
			}

			// benefit calculation
			var ben = $('#tally .mbenefit');
			if(total < all_total) {
				var benefit = all_total - total;

				ben.find('.benefit').text( 'Rs. ' + Me.numberFormat(benefit) );
				ben.show();
			} else {
				ben.hide();
			}
		},

		// _______________________________________________

		// _____________ BOCO calculator
		initBOCO: function() {
			// ui control interactions
			// exchange
			
			$('.changer').change(function() {
				var show = $(this).find('option:selected').data('show'),
					hide = $(this).find('option:selected').data('hide');
				if(hide) {
					$(hide).hide();
				}

				if(show) {
					$(show).show();
				}
			}).change();

			// exchange data
			$('#exchange').change(function() {
				Me.populateBOCOui($('#exchange').val());
				$('#scrip').change();
			}).change();

			// scrip lot size
			$('#scrip').change(function() {
				var lz = $(this).find('option:selected').data('lot_size');
				if(lz) {
					$('#lot_size .val').text(lz);
					$('#qty').val(lz);
				}

				// price
				var show_price = true;
				if($('#product').val() == 'OPT') {
					if($(this).val().indexOf("NIFTY") != -1) {
						$('#span .buysell .buy').show();
						show_price = false;
					} else {
						$('#span .buysell .buy').hide();
					}
				} else {
					$('#span .buysell .buy').show();
				}

				// show price?
				if(show_price) {
					var price = $(this).find('option:selected').data('price');
					if(price) {
						$('#price').val(price);
					} else {
						$('#price').val(0);
					}
				} else {
					$('#price').val("");
				}
			}).change();

			// add span calculation
			$('#form-boco').submit(function() {
				Me.calculateBOCO();
				return false;
			});

			// option->buy disable
			$('#product').change(function() {
				if($(this).val() == 'OPT') {
					$('#span .buysell .buy').hide();
					$('#span .buysell .trade-sell').prop('checked', true);
					$('#span #opt-buysell').show();

					$('#span .field.stl').hide();

					$('#span .field.price label').text('Premium');
				} else {
					$('#span .buysell .buy').show();
					$('#span #opt-buysell').hide();
					$('#span .field.stl').show();
					$('#span .field.price label').text('Price');
				}
			});

		},
		populateBOCOui: function(field) {
			var sym = $('#scrip'),
				names = [];
			sym.empty();

			// option buy/sell
			$('#span .buysell .buy').show();
			$('#span #opt-buysell').hide();
			$('#span .field.stl').show();
			$('#span .field.stl').show();
			$('#span .field.price label').text('Price');

			switch(field) {
				case 'EQ':
					// gather names and sort
					for(var nm in EQ) {
						if(EQ.hasOwnProperty(nm)) {
							names.push(nm);
						}
					}
					names.sort();

					for(var n=0; n<names.length; n++) {
						sym.append( $('<option>').val(names[n]).append(names[n]) );
					}

					$('#lot_size').hide();
					$('#price').val(0);
					$('#stl').val(0);
					$('#qty').val(1);
				break;
				case 'NFO':
					// gather names and sort
					for(var item in FUTURES) {
						if(FUTURES.hasOwnProperty(item)) {
							names.push(item);
						}
					}
					names.sort();

					for(var n=0; n<names.length; n++) {
						sym.append(
							$('<option>').val(names[n]).append( FUTURES[ names[n] ]["scrip"] + " " + FUTURES[ names[n] ]["expiry"] )
							.data('lot_size', FUTURES[ names[n] ]["lot_size"])
							.data('price', FUTURES[ names[n] ]["price"])
						);
					}

					$('#lot_size').show();
				break;
				case 'MCX':
					// gather names and sort
					for(var item in COMMODITIES) {
						if(COMMODITIES.hasOwnProperty(item)) {
							names.push(item);
						}
					}
					names.sort();

					for(var n=0; n<names.length; n++) {
						sym.append(
							$('<option>').val(names[n]).append( COMMODITIES[ names[n] ]["scrip"] )
							.data('lot_size', COMMODITIES[ names[n] ]["lot_size"])
							.data('unit', COMMODITIES[ names[n] ]["unit"])
							.data('price', COMMODITIES[ names[n] ]["price"])
						);
					}

					$('#lot_size').show();
				break;
				case 'CDS':
					// gather names and sort
					for(var item in CURRENCIES) {
						if(CURRENCIES.hasOwnProperty(item)) {
							names.push(item);
						}
					}
					names.sort();

					for(var n=0; n<names.length; n++) {
						sym.append(
							$('<option>').val(names[n]).append( CURRENCIES[ names[n] ]["scrip"] + " " + CURRENCIES[ names[n] ]["expiry"] )
							.data('lot_size', CURRENCIES[ names[n] ]["lot_size"])
							.data('price', CURRENCIES[ names[n] ]["price"])
						);
					}

					$('#lot_size').show();
				break;
			}
		},		

		// _________________________________

		calculateBOCO: function() {
			var scrip = $('#scrip').val();

			// validation
			var qty = $('#qty').val();
			if(!qty || isNaN(qty*1)) {
				qty = 1;
				$('#qty').val(1);
			}
			qty = parseInt(qty);

			// negative qty
			if(qty < 0) {
				qty = Math.abs(qty);
				$('#qty').val(qty);
				$('#form-boco .trade-sell').attr('checked', 1);
			}

			var price = $('#price').val();
			if(!price || isNaN(price*1)) {
				alert("Please enter a valid price");
				$('#price').focus().select();
				return false;
			}
			price = parseFloat(price);

			var stl = $('#stl').val();
			if(!stl || isNaN(stl*1)) {
				$('#stl').val(0);
				stl = 0;
			}
			stl = parseFloat(stl);

			// lot size multiple
			var lot_size = parseInt( $('#scrip option:selected').data('lot_size') );
			if(!isNaN(lot_size) && lot_size > 0) {
				qty = Math.ceil(qty / lot_size) * lot_size;
			}
			$('#qty').val(qty);


			// strike price
			var strike_price = 0;
			if($('#product').val() == 'OPT' && $('#exchange').val() == 'NFO') {
				strike_price = $('#strike_price').val();

				if(!strike_price || isNaN(strike_price*1)) {
					alert("Please enter a valid strike price");
					$('#strike_price').focus().select();
					return false;
				}
				strike_price = parseInt(strike_price);
			}

			var margin = "N/A", bors = "buy";
			if($('.trade-sell:checked').length > 0) {
				bors = "sell";
			}

			switch($('#exchange').val()) {
				case 'EQ':
					var co_lower = parseFloat(EQ[scrip]["co_lower"]) / 100,
						co_upper = parseFloat(EQ[scrip]["co_upper"]) / 100;

					var trigger = price - (co_upper * price);
					if(stl < trigger) {
						$('#stl').val(Math.ceil(trigger));
					} else {
						trigger = stl;
					}

					var	x = 0;
					if(bors == "buy") {
						x = (price - trigger) * qty;
					} else {
						x = (trigger - price) * qty;
					}
					var y = co_lower * price * qty;

					// whichever is the highest is the margin
					margin = x > y ? x : y;
					margin += margin * 0.20;
				break;
				case 'NFO':
					if($('#product').val() == 'OPT') {
						// nifty and banknifty
						if($('#scrip').val().indexOf("NIFTY") != -1 && $('input.trade-buy').is(':checked')) {
							margin = price * qty * 0.70;
						} else {
							margin = (strike_price + price) * qty * 0.025;
						}
					} else {
						var co_lower = parseFloat(FUTURES[scrip]["co_lower"]) / 100,
							co_upper = parseFloat(FUTURES[scrip]["co_upper"]) / 100;

						var trigger = price - (co_upper * price);
						if(stl < trigger) {
							$('#stl').val(Math.ceil(trigger));
						} else {
							trigger = stl;
						}

						var	x = 0;
						if(bors == "buy") {
							x = (price - trigger) * qty;
						} else {
							x = (trigger - price) * qty;
						}

						var y = co_lower * price * qty;

						// whichever is the highest is the margin
						margin = x > y ? x : y;
						margin += margin * .20;
					}
				break;
				case 'MCX':
					var co_lower = 0.01,
						co_upper = 0.019;

					var trigger = price - (co_upper * price);

					if(stl < trigger) {
						$('#stl').val(Math.ceil(trigger));
					} else {
						trigger = stl;
					}

					var	x = 0;
					if(bors == "buy") {
						x = (price - trigger) * qty;
					} else {
						x = (trigger - price) * qty;
					}

					var y = co_lower * price * qty;

					// whichever is the highest is the margin
					margin = x > y ? x : y;
					margin += margin * .4;
				break;
				case 'CDS':
					var co_lower = parseFloat(CURRENCIES[scrip]["co_lower"]) / 100,
						co_upper = parseFloat(CURRENCIES[scrip]["co_upper"]) / 100;

					var trigger = price - (co_upper * price);
					if(stl < trigger) {
						$('#stl').val(Math.ceil(trigger));
					} else {
						trigger = stl;
					}

					var	x = 0;
					if(bors == "buy") {
						x = (price - trigger) * qty;
					} else {
						x = (trigger - price) * qty;
					}

					var y = co_lower * price * qty;

					// whichever is the highest is the margin
					margin = x > y ? x : y;
					margin += margin * 0.20;
				break;
			}
			$('#actual-val').text( this.numberFormat(price*qty) );
			$('#leverage').text( parseFloat((price*qty)/margin, 1).toFixed(1) );
			$('#margin-req').text( this.numberFormat(Math.ceil(margin)) );

			return false;

		},
		
		populateBOCO: function(span, exposure, spread, netoptionvalue, total) {
			// populate total box
			$('#tally .span').text( 'Rs. ' + Me.numberFormat(span) );
			$('#tally .exposure').text( 'Rs. ' + Me.numberFormat(exposure) );
			$('#tally .total').text( 'Rs. ' + Me.numberFormat(total) );
		},


		// _______________________________________________

		numberFormat: function(num) {
			num = Math.round(num, 0);

			num += ''; // converts integer to string
			var explrestunits = '', thecash=null;
			if(num.length>3) {
				var lastthree = num.substr(-3);
				var restunits = num.substr(0, num.length-3);

				restunits = (restunits.length%2 == 1)?"0"+restunits:restunits; 

				var expunit = restunits.match(/.{1,2}/g);
				for(i=0; i<expunit.length; i++) {
					if(i==0)
						explrestunits += parseInt(expunit[i]) + ',';	
					else
						explrestunits += expunit[i] + ',';	

					thecash = explrestunits + lastthree;
				}
			}
			else {
				thecash = num;
			}
			return thecash;
		}
	}

};
