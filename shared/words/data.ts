// Built-in Vietnamese word packs. Comma-separated, NFC, lower-case, correct diacritics.
// Checked by scripts/check-words.ts (duplicates, diacritics, syllable shape). Keep family-friendly and drawable.

export type Difficulty = 'easy' | 'medium' | 'hard';

export const CATEGORY_LABELS = {
  object: 'Đồ vật',
  animal: 'Con vật',
  food: 'Đồ ăn',
  job: 'Nghề nghiệp',
  action: 'Hành động',
  place: 'Địa điểm Việt Nam',
  nature: 'Thiên nhiên',
  vehicle: 'Phương tiện',
  festival: 'Lễ hội & văn hóa',
  body: 'Cơ thể & trang phục',
  sport: 'Thể thao & trò chơi',
  school: 'Trường học & âm nhạc',
} as const;

export type CategoryId = keyof typeof CATEGORY_LABELS;

type Pack = Record<Difficulty, string>;

export const WORD_DATA: Record<CategoryId, Pack> = {
  object: {
    easy: 'cái bàn, cái ghế, cái cốc, cái bát, cái đĩa, cái thìa, đôi đũa, cái nồi, cái chảo, con dao, cái kéo, cái bút, quyển sách, cái cặp, cái kính, cái nón, cái ô, chìa khóa, đồng hồ, cái gương, cái giường, cái tủ, cái đèn, quạt máy, ti vi, điện thoại, cái thang, cái chai, quả bóng, cái búa',
    medium: 'cái gối, chăn bông, cái chổi, cái xô, cái rổ, cái thùng, bình hoa, khung tranh, cái lược, bàn chải đánh răng, cái cân, ổ khóa, cái cưa, cái kìm, cái đinh, cuộn len, cây kim, cúc áo, ngọn nến, hộp diêm, bình nước, ấm trà, nồi cơm điện, tủ lạnh, máy giặt, máy tính, bàn phím, tai nghe, cái loa, máy ảnh, đèn pin, đèn lồng, quạt giấy, giường cũi, xe đẩy em bé, cái võng, bản đồ, la bàn, cái bật lửa, cái muôi',
    hard: 'kính lúp, kính thiên văn, đồng hồ cát, chuông gió, cối xay, cân đòn, máy khâu, bộ ấm chén, ống nhòm, bẫy chuột, bình cứu hỏa, hòm thư, đèn pha, thang cuốn, cái mõ, ổ cắm điện, máy hút bụi, máy sấy tóc, đèn bàn, mắc áo, chiếc nhẫn, vòng cổ, gối ôm, bàn là, máy xay sinh tố',
  },
  animal: {
    easy: 'con chó, con mèo, con gà, con vịt, con ngỗng, con heo, con bò, con trâu, con dê, con ngựa, con thỏ, con chuột, con cá, con ếch, con rắn, con voi, con hổ, con sư tử, con khỉ, con gấu, con chim, con bướm, con ong, con kiến, con cua, con tôm, con rùa, con sâu, con ốc, con nhện',
    medium: 'con hươu cao cổ, con ngựa vằn, con hà mã, con tê giác, con lạc đà, con cá sấu, con gấu trúc, con cáo, con sói, con nai, con công, con cú mèo, con đại bàng, con chim cánh cụt, con cá heo, con cá voi, con cá mập, con bạch tuộc, con sao biển, con ngựa biển, con chuồn chuồn, con bọ rùa, con châu chấu, con dơi, con sóc, con nhím, con thằn lằn, con tắc kè, con cóc, con ve sầu, con muỗi, con ruồi, con chim bồ câu, con quạ, con vẹt, con thiên nga, con hải âu, con cò, con gà trống',
    hard: 'con tê tê, con ốc sên, con cá chép, con cá chình, con lươn, con chuột túi, con gấu bắc cực, con báo đốm, con linh cẩu, con đà điểu, con chim ruồi, con cá ngựa, con sứa, con mực, con hàu, con sò, con nòng nọc, con sâu bướm, con kén tằm, con rết, con bọ cạp, con cá nóc, con cá đuối, con rái cá, con trăn, con cá lóc, con cá trê, con gà con, con vịt con, con khủng long, con lân, con rồng, con kỳ lân, con phượng hoàng, con hải cẩu, con hải mã, con voi ma mút, con cá voi sát thủ, con bọ hung, con chim gõ kiến',
  },
  food: {
    easy: 'cơm, phở, bún, bánh mì, trứng chiên, xôi, cháo, bánh chưng, kẹo, kem, bánh kem, sữa, nước cam, quả chuối, quả táo, quả cam, quả dưa hấu, quả dứa, quả xoài, quả nho, quả dâu tây, quả lê, quả đào, quả cà chua, củ cà rốt, củ khoai tây, bắp ngô, quả dưa leo, rau muống, bánh quy',
    medium: 'bún chả, bún bò, bánh cuốn, bánh xèo, bánh bao, bánh tét, bánh trung thu, chả giò, nem rán, gỏi cuốn, cơm tấm, cơm rang, mì tôm, hủ tiếu, bánh bèo, xôi gấc, chè ba màu, sữa chua, kem que, bánh flan, bánh vòng, bánh pizza, bánh mì kẹp thịt, xúc xích, thịt nướng, gà rán, cá kho, canh chua, tôm hùm, cua rang me, quả chôm chôm, quả vải, quả nhãn, quả sầu riêng, quả mít, quả bưởi, quả thanh long, nước dừa, quả măng cụt, quả ớt, củ hành, củ tỏi, nấm rơm, đậu phụ, bánh gạo, bỏng ngô, kẹo bông, bánh su kem',
    hard: 'bánh đa nem, bún riêu, mì quảng, cao lầu, bánh canh, bánh pía, chè trôi nước, bánh tráng nướng, bánh cam, bánh rán, nem chua, thịt đông, dưa muối, cà phê sữa đá, trà sữa, sinh tố bơ, nước mía, rau câu, bánh khúc, lẩu thái, gà quay, vịt quay, ốc luộc, cháo lòng',
  },
  job: {
    easy: 'bác sĩ, y tá, giáo viên, học sinh, công an, bộ đội, nông dân, ngư dân, đầu bếp, thợ may, thợ xây, thợ mộc, ca sĩ, diễn viên, họa sĩ, nhà báo, lính cứu hỏa, phi công, tài xế, người bán hàng, thợ cắt tóc, nha sĩ, người đưa thư, ông già',
    medium: 'kỹ sư, nhà khoa học, nhà du hành vũ trụ, thợ điện, thợ sửa xe, thợ làm bánh, thợ chụp ảnh, nhạc công, vũ công, nhà văn, bác sĩ thú y, người pha chế, người dọn vệ sinh, bảo vệ, cảnh sát giao thông, người bán hoa, người làm vườn, người chăn bò, người bán cá, người gánh hàng rong, người bán báo, trọng tài, huấn luyện viên, nhân viên bán vé, tiếp viên hàng không, thuyền trưởng, thợ lặn, thợ hồ, người lái đò, người bán kem',
    hard: 'nhà địa chất, nhà thiên văn, nhà khảo cổ, thợ kim hoàn, thợ gốm, thợ rèn, thợ đóng giày, nhà ảo thuật, diễn viên xiếc, người nuôi ong, nhà điêu khắc, người dẫn chương trình, nghệ nhân múa rối, lực sĩ, thợ sửa đồng hồ, dược sĩ, nhà hóa học, phóng viên, thẩm phán, người lái tàu',
  },
  action: {
    easy: 'ăn cơm, uống nước, ngủ, chạy, nhảy, đi bộ, hát, múa, cười, khóc, đọc sách, viết bài, vẽ tranh, tắm, đánh răng, rửa mặt, gội đầu, nấu ăn, quét nhà, giặt đồ, bơi lội, leo cây, đá bóng, câu cá, ngồi, đứng, vẫy tay, hôn, ôm, hắt hơi',
    medium: 'chơi đàn, chụp ảnh, gọi điện, nhắn tin, lái xe, đạp xe, trượt ván, trượt băng, chèo thuyền, cắm trại, nướng thịt, rửa bát, tưới cây, trồng cây, đào đất, cắt tóc, thổi bóng bay, thả diều, nhảy dây, kéo co, bịt mắt bắt dê, ném tuyết, xây lâu đài cát, thổi nến, đẩy xe, bế em bé, ngáp, ho, run, vỗ tay, bắt tay, chào cờ, xếp hàng, đi chợ, mua sắm, ăn mì, uống trà, xem phim, chơi điện tử, nghe nhạc',
    hard: 'suy nghĩ, mơ mộng, ngạc nhiên, tức giận, xấu hổ, buồn ngủ, cãi nhau, làm hòa, trốn tìm, rình mò, nhón chân, lén lút, đánh đu, bắt chước, thì thầm, làm xiếc, tập thể dục, tập thể dục buổi sáng, nhảy múa, giặt thảm',
  },
  place: {
    easy: 'Hà Nội, Sài Gòn, Đà Nẵng, Huế, Hải Phòng, Cần Thơ, Hạ Long, Sa Pa, Đà Lạt, Nha Trang, Phú Quốc, Hội An, chợ, trường học, bệnh viện, công viên, bãi biển, nhà thờ, ngôi chùa, sân bay, bến xe, nhà ga, siêu thị, thư viện, sở thú, rạp chiếu phim',
    medium: 'Hồ Gươm, Tháp Rùa, Văn Miếu, Lăng Bác, Chùa Một Cột, Cầu Rồng, Cầu Vàng, Bà Nà, Chợ Bến Thành, Nhà thờ Đức Bà, Bưu điện thành phố, Dinh Độc Lập, Phố cổ Hội An, Cố đô Huế, Vịnh Hạ Long, Động Phong Nha, Ruộng bậc thang, Mũi Cà Mau, Đồng bằng sông Cửu Long, Chợ nổi Cái Răng, Đảo Cát Bà, Hồ Tây, Tràng Tiền, Núi Bà Đen, Bãi Sao, Thác Bản Giốc, Bán đảo Sơn Trà, Cột cờ Lũng Cú, Đỉnh Phan Xi Păng, Hang Sơn Đoòng',
    hard: 'Hoàng thành Thăng Long, Thánh địa Mỹ Sơn, Địa đạo Củ Chi, Nhà tù Hỏa Lò, Cầu Long Biên, Cầu Thê Húc, Chợ Đồng Xuân, Nhà hát Lớn, Chùa Thiên Mụ, Lăng Khải Định, Tháp Chàm, Đền Hùng, Bảo tàng Dân tộc học, Hồ Ba Bể, Thung lũng Mai Châu, Đồi chè Mộc Châu, Làng gốm Bát Tràng, Làng lụa Vạn Phúc, Cánh đồng muối, Rừng ngập mặn Cần Giờ',
  },
  nature: {
    easy: 'mặt trời, mặt trăng, ngôi sao, đám mây, cơn mưa, cầu vồng, tia chớp, ngọn núi, dòng sông, cái hồ, biển, bãi cát, hòn đảo, cái cây, bông hoa, chiếc lá, ngọn cỏ, hòn đá, ngọn lửa, bông tuyết, người tuyết, cầu vồng đôi, con suối, thác nước, cánh rừng',
    medium: 'bão, lốc xoáy, sấm sét, sương mù, giọt sương, nhật thực, nguyệt thực, sao băng, thiên hà, trái đất, sao Hỏa, sao Thổ, dải ngân hà, núi lửa, hang động, sa mạc, ốc đảo, cồn cát, vách đá, rạn san hô, đầm lầy, cánh đồng lúa, đồi chè, rừng tre, vườn dừa, hoa sen, hoa mai, hoa đào, hoa hướng dương, hoa hồng, hoa cúc, cây xương rồng, cây thông, cây dừa, cây tre, cây chuối, bụi tre, nấm, cành cây, tổ chim',
    hard: 'động đất, sóng thần, lũ lụt, hạn hán, thủy triều, cực quang, vòng tuần hoàn nước, đá ong, thạch nhũ, băng hà, hẻm núi, cửa sông, đồng cỏ, rừng nhiệt đới, bình minh, hoàng hôn, đêm trăng rằm, mùa thu lá vàng, ngày nắng nóng, gió mùa',
  },
  vehicle: {
    easy: 'xe đạp, xe máy, ô tô, xe buýt, xe tải, tàu hỏa, máy bay, tàu thủy, thuyền buồm, xe cứu thương, xe cứu hỏa, xe cảnh sát, xe ba gác, xe lam, xe xích lô, xe ngựa, xe lăn, xe đẩy, ca nô, khinh khí cầu, trực thăng, tên lửa, tàu ngầm, xe ủi, xe cần cẩu',
    medium: 'xe ôm, xe công nông, xe bồn, xe công te nơ, xe đua, xe tăng, xe khách giường nằm, xe điện, tàu điện, tàu cao tốc, cáp treo, thuyền thúng, ghe ngo, thuyền rồng, thuyền nan, phà, tàu cá, tàu chiến, tàu sân bay, tàu vũ trụ, dù lượn, ca nô cứu hộ, xe trượt tuyết, xe đạp đôi, xe ba bánh, xe kéo, xe chở rác, xe trộn bê tông, xe nâng hàng, máy xúc',
    hard: 'xe lu, xe ben, xe đào, xe cuốc, tàu quét mìn, thủy phi cơ, tàu phá băng, xe bán tải, xe thang cứu hỏa, tàu điện ngầm, xe trượt băng, xe đạp địa hình, xe buýt hai tầng, xe cứu hộ, xe phun nước, xe bọc thép',
  },
  festival: {
    easy: 'Tết Nguyên đán, Tết Trung thu, múa lân, múa rồng, mứt Tết, lì xì, cành đào, cành mai, cây nêu, pháo hoa, đèn kéo quân, đèn ông sao, mâm ngũ quả, câu đối đỏ, ông Công ông Táo, chợ hoa, bao lì xì, mặt nạ, trống ếch, phong bao đỏ',
    medium: 'giỗ tổ Hùng Vương, lễ hội đua thuyền, lễ hội chùa Hương, hội Gióng, hội Lim, hát quan họ, hát chèo, múa rối nước, đua ghe ngo, đấu vật, chọi trâu, hội làng, rước kiệu, thả đèn hoa đăng, thả cá chép, cúng ông bà, thắp hương, dâng hoa, tảo mộ, chợ Tết, bánh dày, phá cỗ Trung thu, rước đèn, lễ Vu Lan, lễ Phật đản, Giáng sinh, ông già Nô-en, cây thông Nô-en, lễ cưới, áo dài cưới',
    hard: 'hát xẩm, ca trù, cải lương, tuồng, đờn ca tài tử, nhã nhạc cung đình, cồng chiêng, lễ hội Katê, hội chợ Xuân, chợ tình, lễ cúng rằm, tục xông đất, đón giao thừa, bắn pháo hoa, ném còn, đánh đu ngày Tết, hái lộc đầu năm, gói bánh chưng, tranh Đông Hồ',
  },
  body: {
    easy: 'cái đầu, mái tóc, đôi mắt, cái mũi, cái miệng, đôi tai, cái răng, cái lưỡi, bàn tay, ngón tay, bàn chân, cái chân, cánh tay, cái bụng, khuôn mặt, râu, lông mày, áo sơ mi, quần dài, quần đùi, cái váy, đôi giày, đôi dép, đôi tất, cái mũ, cái khăn, găng tay, áo khoác, cà vạt, thắt lưng',
    medium: 'ngón cái, cái cằm, cái cổ, bờ vai, khuỷu tay, đầu gối, mắt cá chân, móng tay, lông mi, dấu vân tay, trái tim, bộ xương, hộp sọ, áo dài, nón lá, khăn rằn, áo bà ba, áo phao, áo mưa, áo len, áo ba lỗ, váy xòe, đồ bơi, kính râm, ba lô, ví tiền, cái túi xách, đôi ủng, giày cao gót, giày thể thao, dép lê, mũ bảo hiểm, mũ len, khẩu trang, băng đô, dây chuyền, vòng tay, bông tai, đồng hồ đeo tay, cà vạt nơ',
    hard: 'áo tứ thân, khăn mỏ quạ, áo giáp, mũ cối, nón quai thao, khố, áo choàng trắng, bộ com lê, váy cưới, giày bốt, tóc tết, tóc xoăn, hói đầu, má lúm đồng tiền, nốt ruồi, răng khểnh, bụng bia, tóc bím, mắt hí, râu quai nón',
  },
  sport: {
    easy: 'bóng đá, bóng rổ, bóng chuyền, bóng bàn, cầu lông, quần vợt, bơi sải, chạy bộ, cưỡi ngựa, cờ vua, cờ tướng, cờ ca rô, đá cầu, nhảy bao bố, đẩy gậy, đập niêu, diều giấy, búp bê, gấu bông, xếp hình, đồ chơi xe, ô ăn quan, bi ve, quay vòng, trò đuổi bắt, cầu trượt, xích đu, bập bênh, ném vòng, đá gà',
    medium: 'bóng chày, bóng bầu dục, khúc côn cầu, gôn, bơi thuyền, bắn cung, bắn súng, đấu kiếm, vật tay, cử tạ, nhảy cao, nhảy xa, nhảy sào, chạy vượt rào, ném lao, ném tạ, ném đĩa, thể dục dụng cụ, thể dục nhịp điệu, nhảy cầu, lướt sóng, trượt tuyết, trượt pa tin, leo núi, đi bộ đường dài, câu cá thể thao, võ cổ truyền, võ karate, bóng nước, bi sắt, lò cò, cướp cờ, rồng rắn lên mây, chơi ú òa, chơi chuyền, ô tô điều khiển, xếp hình lego, rubik',
    hard: 'cờ vây, cờ tỉ phú, bài tây, cờ đô mi nô, xếp bài, xe lắc, đua ngựa, đua xe đạp, chạy ma ra tông, ba môn phối hợp, trượt băng nghệ thuật, nhảy dù, đu quay, tàu lượn siêu tốc, nhà ma, lướt ván diều, chèo xuồng, bóng ném, bi-a, bóng nước biển',
  },
  school: {
    easy: 'bảng đen, phấn trắng, cái thước, cục tẩy, bút chì, bút bi, bút màu, quyển vở, cặp sách, bàn học, ghế đá, sân trường, trống trường, cờ đỏ, khăn quàng đỏ, bộ đồng phục, sách giáo khoa, tờ giấy, hộp bút, gọt bút chì, đàn ghi ta, đàn vi ô lông, bộ trống, cái trống, cái kèn, sáo trúc, loa phóng thanh, loa kéo, nốt nhạc, bài hát',
    medium: 'com pa, ê ke, thước kẻ, máy tính bỏ túi, quả địa cầu, bản đồ thế giới, kính hiển vi, ống nghiệm, bình tam giác, phòng thí nghiệm, thư viện trường, căng tin, phòng học, giờ ra chơi, lễ khai giảng, lễ tổng kết, điểm mười, bảng cửu chương, bài kiểm tra, cuốn sổ liên lạc, bút lông, mực tàu, nghiên mực, đàn tranh, đàn bầu, đàn nhị, đàn đáy, đàn tơ rưng, sáo, kèn ác mô ni ca, dàn nhạc, nhạc trưởng, người chơi ghi ta, khuông nhạc, chìa khóa son, ban nhạc, sân khấu, rèm cửa sân khấu, đàn dương cầm',
    hard: 'sơ đồ tư duy, hình học không gian, hệ mặt trời, bảng tuần hoàn, máy chiếu, bảng tương tác, học trực tuyến, kỳ thi tốt nghiệp, bằng khen, giấy khen, huy chương vàng, cúp vô địch, đàn nguyệt, đàn tỳ bà, trống đồng, kèn bầu, đàn môi, khèn, đàn chuông, dàn đồng ca',
  },
};
