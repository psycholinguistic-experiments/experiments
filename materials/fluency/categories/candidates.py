"""Candidate animal and fruit/vegetable words in SUBTLEX-CH: every word with a
character from a broad set of animal or plant-food characters. The candidates
are then classified by hand (review files) -- this step only narrows 99,121
words down to the ones worth reading."""
import json
ANIMAL = set('猫狗犬狼狐狸猴猿狒猩熊虎狮豹象鹿麋獐麂驼骆马驴骡牛犊羊羔猪豚兔鼠蛇蟒蝮蛙蟾蜍龟鳖鸡鸭鹅鸟雀鹰鸽燕鹤鹭鸥鸦鹊莺鹦鹉雕隼鹫枭鸮鹌鹑雁鸳鸯鸵鹳鹈鹕鹬鹞鸨鹧鸪鹂鹃鸠鹮翠蝠獾貂獭豺狈犀河羚鲸鲨鱼鲤鲫鳗鳝鲈鳕鲑鳟鲶鲳鲷鳄蟹虾贝螺蚌蛤蚝蛎鱿贼蜗蚯蚓虫蚁蜂蝶蛾蝇蚊蝉蟋蟀螳螂蜻蜓蝗蚱蜘蛛蝎蜈蚣蟑跳蚤虱蛆蛹蚕萤蜥蜴螈貘獴猞猁犰狳袋考树懒鼬豪猪刺猬蝙蜜獒狍麝鬣狗羚鼹鲟鳐鲀鳍海豹狮獬猊鹏凤凰龙麟貔貅兽禽畜雏鸵鹌企骏驹羯牦犍狨猕貉狩'
             '蚜蝽蠓蚋蜱螨蝼蛄蜣螂蛐蛇蛟蜃蚂蟥蛭鲍螯鲎鳌鳕鲱鲭鳀鲣鲮鳙鲢鳊鳜鲥鳢鲇蛔')
FRUITVEG = set('果瓜菜莓桃梨李杏梅枣柿橘橙柑柚柠檬芒荔枝眼葡萄蕉苹菠萝榴莲椰杨桑樱榄枇杷猕山竹茄薯芋卜葱蒜姜韭芹芥莴笋椒豆蘑菇菌耳藕菱蔗芦荟蕨苋茼蒿芫荽荸荠慈芸薹蓝甘番薤藠莼蕹莴苣蔓菁芜菘薇芋柑橼榛栗核桃仁杏腰榧松子莲蓬菰茭笋藜麦玉米粟蕙芽苗花生椰枸杞桂圆楂杨梅黄皮蒲桃番荔枝蛇莓蒲公英马齿苋鱼腥草')
lines = [l.split('\t') for l in open('../../../assets/data/subtlex-ch-wf.txt', encoding='utf-8') if l and l[0] != '#']
words = [(w, int(c)) for w, c in lines]
an = [w for w, c in words if len(w) <= 6 and any(ch in ANIMAL for ch in w)]
fv = [w for w, c in words if len(w) <= 6 and any(ch in FRUITVEG for ch in w)]
# generic characters (马上, 山东, 花园, 生日, 黄色, 子女 ...) bring thousands of false candidates;
# names that need them (花生, 玉米, 马, 鱼) come from the knowledge lists instead
GENERIC = set('子花生山黄皮眼甘仁草公英齿松玉米麦苗芽竹杨桑李梅核蒲心蓝河海树考袋跳刺豪甲蛇龙马鱼凤凰麟兽禽畜贼河眼番慈芸蔓菘皮豆')
ANIMAL -= GENERIC; FRUITVEG -= GENERIC
# ...but a word ending in one of these is worth reading (金鱼, 斑马, 眼镜蛇, 恐龙, 豌豆, 花生, 玉米, 西兰花)
AN_HEAD, FV_HEAD = set('鱼马蛇龙兽禽鹅'), set('豆米生花梅李桑子仁皮芽苗草')
an = [w for w, c in words if len(w) <= 6 and (any(ch in ANIMAL for ch in w) or w[-1] in AN_HEAD)]
fv = [w for w, c in words if len(w) <= 6 and (any(ch in FRUITVEG for ch in w) or (w[-1] in FV_HEAD and len(w) <= 4 and w[-1] != '子') or (w[-1] == '子' and len(w) == 2))]
print('SUBTLEX words', len(words), '| animal-character candidates', len(an), '| fruit/veg-character candidates', len(fv), '| union', len(set(an) | set(fv)))
json.dump({'animals': an, 'fruitveg': fv}, open('candidates.json', 'w', encoding='utf-8'), ensure_ascii=False)
